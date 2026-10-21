export type FeaturedCourse = {
  id: string;
  category: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  rating: string;
  learners: string;
  days: number;
  level: string;
  highlights: string[];
};

// Presentation content supplied in frontend_demo/TrangChu.html, not live catalog data.
export const featuredCourses: FeaturedCourse[] = [
  {
    id: "ielts", category: "IELTS Band 7.5+", title: "IELTS Speaking & Writing 7.5+ Mastery",
    description: "Luyện đề thi với giám khảo AI ảo, chấm từng Task 1, Task 2 và 3 phần Speaking.",
    image: "/images/courses/ielts.jpg", imageAlt: "Góc học tập của học viên luyện thi IELTS",
    rating: "4.95", learners: "12,400", days: 45, level: "C1 Level",
    highlights: ["Luyện ba phần thi Speaking", "Phát triển ý tưởng Writing Task 1 và Task 2", "Củng cố từ vựng học thuật và cách diễn đạt"],
  },
  {
    id: "business", category: "Doanh nghiệp", title: "Business English & Đàm phán Quốc tế",
    description: "Kỹ năng viết email thương mại thuyết phục, thuyết trình dự án và đàm phán hợp đồng song phương.",
    image: "/images/courses/business.jpg", imageAlt: "Các chuyên gia trao đổi trong cuộc họp kinh doanh",
    rating: "4.92", learners: "8,920", days: 30, level: "B2 – C1",
    highlights: ["Viết email thương mại rõ ràng, thuyết phục", "Thực hành thuyết trình và trao đổi dự án", "Luyện tình huống đàm phán quốc tế"],
  },
  {
    id: "communication", category: "Giao tiếp", title: "Tiếng Anh Giao tiếp Công sở Phản xạ",
    description: "Xóa bỏ rào cản sợ nói, phản xạ tức thì trong các cuộc họp standup, báo cáo tuần và trò chuyện xã giao.",
    image: "/images/courses/communication.jpg", imageAlt: "Đồng nghiệp giao tiếp trong không gian làm việc hiện đại",
    rating: "4.89", learners: "15,800", days: 60, level: "A2 → B2",
    highlights: ["Luyện giao tiếp trong công việc hằng ngày", "Thực hành báo cáo và trao đổi trong cuộc họp", "Xây dựng phản xạ và sự tự tin khi nói"],
  },
  {
    id: "pronunciation", category: "Nền tảng IPA", title: "Chinh phục Phát âm Mỹ chuẩn IPA",
    description: "Làm chủ 44 âm IPA, trọng âm từ, nuốt âm, nối âm Flap-T và ngữ điệu câu tự nhiên như người bản xứ.",
    image: "/images/courses/pronunciation.jpg", imageAlt: "Học viên luyện nghe và phát âm bằng tai nghe",
    rating: "4.97", learners: "21,500", days: 21, level: "Mọi trình độ",
    highlights: ["Làm quen và luyện tập 44 âm IPA", "Thực hành nối âm, trọng âm và ngữ điệu", "Luyện phát âm qua các câu giao tiếp thực tế"],
  },
];
