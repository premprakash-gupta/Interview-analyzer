export interface Question {
  text: string;
  timeLimit: number; // in seconds
}

export const QUESTION_BANK: { [key: string]: Question[] } = {
  technical: [
    { text: "Tell me about yourself and your technical background.", timeLimit: 90 },
    { text: "Describe a challenging technical problem you solved recently.", timeLimit: 120 },
    { text: "How do you approach debugging complex issues in your code?", timeLimit: 90 },
    { text: "Explain a technical concept you recently learned to a non-technical person.", timeLimit: 120 },
    { text: "Where do you see yourself in the next 3-5 years as a developer?", timeLimit: 60 }
  ],
  sales: [
    { text: "Tell me about yourself and your sales experience.", timeLimit: 90 },
    { text: "How do you handle rejection from potential clients?", timeLimit: 60 },
    { text: "Describe your most successful sales pitch and why it worked.", timeLimit: 120 },
    { text: "How do you identify and qualify potential leads?", timeLimit: 90 },
    { text: "What strategies do you use to close a difficult deal?", timeLimit: 120 }
  ]
};

export function getQuestions(interviewType: string, count: number = 5): Question[] {
  const all = QUESTION_BANK[interviewType] || QUESTION_BANK.technical;
  return [...all].sort(() => 0.5 - Math.random()).slice(0, count);
}
