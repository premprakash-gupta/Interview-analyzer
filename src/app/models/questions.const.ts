export const QUESTION_BANK = {
  technical: [
    "Tell me about yourself and your technical background.",
    "Describe a challenging technical problem you solved recently.",
    "How do you approach debugging complex issues in your code?",
    "Explain a technical concept you recently learned to a non-technical person.",
    "Where do you see yourself in the next 3-5 years as a developer?"
  ],
  sales: [
    "Tell me about yourself and your sales experience.",
    "How do you handle rejection from potential clients?",
    "Describe your most successful sales pitch and why it worked.",
    "How do you identify and qualify potential leads?",
    "What strategies do you use to close a difficult deal?"
  ]
};

export function getQuestions(interviewType: string): string[] {
  return QUESTION_BANK[interviewType] || QUESTION_BANK.technical;
}
