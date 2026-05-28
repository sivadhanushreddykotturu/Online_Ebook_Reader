import mongoose, { Schema, Document, Model } from 'mongoose';

export interface UserDocument extends Document {
  name?: string;
  email: string;
  password?: string;
  image?: string;
  emailVerified?: Date | null;
}

const UserSchema = new Schema<UserDocument>(
  {
    name: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    image: { type: String },
    emailVerified: { type: Date, default: null },
  },
  {
    collection: 'users',
    timestamps: true,
  }
);

export const User: Model<UserDocument> =
  mongoose.models.User || mongoose.model<UserDocument>('User', UserSchema);
export default User;
