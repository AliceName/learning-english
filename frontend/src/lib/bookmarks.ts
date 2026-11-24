import { listeningHref } from "./listening";

export type BookmarkType = "course" | "lesson" | "writing" | "flashcard" | "vocabulary";
export type BookmarkKey = { targetType: BookmarkType; targetId: number };
export type Bookmark = BookmarkKey & {
  createdAt: string;
  note?: string | null;
  target: { title: string; parentId: number | null; parentTitle: string | null; skillType: string | null } | null;
};

export const bookmarkTypeLabel: Record<BookmarkType, string> = {
  course: "Khóa học",
  lesson: "Bài học",
  writing: "Bài viết",
  flashcard: "Flashcard",
  vocabulary: "Từ vựng",
};

export const bookmarkKey = ({ targetType, targetId }: BookmarkKey) => targetType + "/" + targetId;

export function bookmarkHref({ target, targetType, targetId }: Bookmark): string | null {
  if (!target) return null;
  switch (targetType) {
    case "course": return "/courses/" + targetId;
    case "writing": return "/writing?submissionId=" + targetId;
    case "flashcard": return target.parentId ? "/flashcards?deckId=" + target.parentId + "&cardId=" + targetId : null;
    case "lesson":
      if (!target.parentId) return null;
      if (target.skillType === "listening") return listeningHref(target.parentId, targetId);
      if (target.skillType === "speaking") return "/courses/" + target.parentId + "/speaking/" + targetId;
      return "/courses/" + target.parentId + "#lesson-" + targetId;
    default: return null;
  }
}
