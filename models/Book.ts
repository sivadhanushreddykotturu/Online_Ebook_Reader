import mongoose, { Schema, Document, Model } from 'mongoose';

export interface BookDocument extends Document {
  userId: string;
  r2Key: string;
  title: string;
  currentPage: number;
  totalPages: number;
  expiresAt: Date | null;
  isVip: boolean;
  notified7Days: boolean;
  coverKey?: string;
  customCoverStyle?: string;
  uploadedAt: Date;
  updatedAt: Date;
}

const BookSchema = new Schema<BookDocument>(
  {
    userId: { type: String, required: true },
    r2Key: { type: String, required: true },
    title: { type: String, required: true },
    currentPage: { type: Number, default: 1, required: true },
    totalPages: { type: Number, required: true },
    expiresAt: { type: Date, default: null },
    isVip: { type: Boolean, default: false, required: true },
    notified7Days: { type: Boolean, default: false, required: true },
    coverKey: { type: String, default: null },
    customCoverStyle: { type: String, default: null },
  },
  {
    timestamps: { createdAt: 'uploadedAt', updatedAt: 'updatedAt' },
  }
);

// Pre-save hook to calculate expiresAt (60 days from now, null if VIP)
BookSchema.pre('save', async function (this: BookDocument) {
  if (this.isVip) {
    this.expiresAt = null;
  } else if (this.isNew && !this.expiresAt) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 60);
    this.expiresAt = expiryDate;
  }
});

export const Book: Model<BookDocument> =
  mongoose.models.Book || mongoose.model<BookDocument>('Book', BookSchema);
export default Book;
