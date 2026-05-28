import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import { clientPromise, connectDB } from '@/lib/mongodb';
import { JWT } from 'next-auth/jwt';
import { User } from '@/models/User';
import { verifyPassword, hashPassword } from '@/lib/password';

// Extend NextAuth types to include custom session and JWT properties
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    error?: string;
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    googleId?: string;
    id?: string;
    expiresAt?: number;
    error?: string;
  }
}

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      throw new Error('Missing refresh token');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken,
      }),
    });

    const refreshedTokens = await response.json();

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return {
      ...token,
      error: 'RefreshTokenError',
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(clientPromise),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'openid email profile',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Missing email or password');
        }

        const email = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;

        await connectDB();

        // Find user by email
        let user = await User.findOne({ email });

        if (!user) {
          // Auto-registration: Create new user with randomized Dicebear adventurer avatar
          const seed = Math.random().toString(36).substring(2, 8);
          const avatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${seed}&backgroundColor=transparent`;
          
          const hashedPassword = hashPassword(password);
          user = await User.create({
            email,
            password: hashedPassword,
            image: avatarUrl,
            name: email.split('@')[0],
          });
        } else {
          // User exists, verify password
          if (!user.password) {
            throw new Error('Please sign in using Google.');
          }

          const isPasswordValid = verifyPassword(password, user.password);
          if (!isPasswordValid) {
            throw new Error('Invalid email or password.');
          }
        }

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, account, user }) {
      if (user) {
        token.id = user.id;
        token.image = user.image;
        token.name = user.name;
      }

      // Initial sign in for Google
      if (account && account.provider === 'google') {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.googleId = account.providerAccountId;
        if (account.expires_in) {
          token.expiresAt = Date.now() + account.expires_in * 1000;
        }
        return token;
      }

      // Return previous token if the access token has not expired yet (Google)
      // or if it's credentials sign in (which doesn't set expiresAt)
      if (!token.expiresAt || (token.expiresAt && Date.now() < token.expiresAt)) {
        return token;
      }

      // Access token has expired, try to update it
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      if (session.user) {
        session.user.id = token.googleId || (token.id as string);
        if (token.image) {
          session.user.image = token.image as string;
        }
        if (token.name) {
          session.user.name = token.name as string;
        }
      }
      if (token.error) {
        session.error = token.error;
      }
      return session;
    },
  },
});
