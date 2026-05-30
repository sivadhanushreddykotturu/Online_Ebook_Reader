import mongoose, { Schema, Document, Model } from 'mongoose';

export interface BookmarkDocument extends Document {
  userId: string;
  bookId: string;
  pageNumber: number;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const BookmarkSchema = new Schema<BookmarkDocument>(
  {
    userId: { type: String, required: true },
    bookId: { type: String, required: true },
    pageNumber: { type: Number, required: true },
    note: { type: String, default: '' },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: one bookmark per page per book per user
BookmarkSchema.index({ userId: 1, bookId: 1, pageNumber: 1 }, { unique: true });

export const Bookmark: Model<BookmarkDocument> =
  mongoose.models.Bookmark || mongoose.model<BookmarkDocument>('Bookmark', BookmarkSchema);
export default Bookmark;
