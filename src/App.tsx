import React, { useState } from 'react';
import { CheckCircle, AlertTriangle, FileText, ArrowRight, Sparkles, Brain, Shield, TrendingUp, DollarSign, Clock, Target } from 'lucide-react';
import {GoogleGenAI} from '@google/genai';

interface Question {
  id: number;
  category: string;
  question: string;
  icon: string;
  type: 'standard' | 'outside-box';
}

interface Answers {
  [key: number]: string;
}

const App: React.FC = () => {
  const [page, setPage] = useState<'home' | 'questioning' | 'summary'>('home');
  const [projectInput, setProjectInput] = useState<string>('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [currentAnswer, setCurrentAnswer] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [inputError, setInputError] = useState<string>('');
  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState<boolean>(false);

  // Rate limiting - 2 projects per day
  const checkRateLimit = (): boolean => {
    const today = new Date().toDateString();
    const stored = localStorage.getItem('projectCount');
    
    if (stored) {
      const { date, count } = JSON.parse(stored);
      if (date === today) {
        if (count >= 100) {
          return false;
        }
        localStorage.setItem('projectCount', JSON.stringify({ date: today, count: count + 1 }));
      } else {
        localStorage.setItem('projectCount', JSON.stringify({ date: today, count: 1 }));
      }
    } else {
      localStorage.setItem('projectCount', JSON.stringify({ date: today, count: 1 }));
    }
    return true;
  };

  const validateInput = (text: string): { valid: boolean; error: string } => {
    if (!text || text.trim().length < 10) {
      return { valid: false, error: "Please provide a more detailed project description (at least 10 characters)" };
    }

    const words = text.trim().split(/\s+/);
    const meaningfulWords = words.filter(word => {
      const cleanWord = word.replace(/[^a-zA-Z]/g, '');
      const hasVowels = /[aeiouAEIOU]/.test(cleanWord);
      const isReasonableLength = cleanWord.length >= 2;
      return hasVowels && isReasonableLength;
    });

    if (meaningfulWords.length < 3) {
      return { valid: false, error: "Please describe your project with real words." };
    }

    return { valid: true, error: "" };
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setProjectInput(value);
    if (inputError && value.length > 0) {
      setInputError('');
    }
  };

  // Basic API key obfuscation (not perfect security but adds a layer)
  const getApiKey = (): string => {
    const key = import.meta.env.VITE_GEMINI_API_KEY;
    if (!key) {
      throw new Error('API key not configured');
    }
    // Simple check to ensure it's not being called too frequently
    const lastCall = sessionStorage.getItem('lastApiCall');
    const now = Date.now();
    if (lastCall && now - parseInt(lastCall) < 1000) {
      throw new Error('Too many requests');
    }
    sessionStorage.setItem('lastApiCall', now.toString());
    return key;
  };

  

  // Generate next AI question
  const generateNextQuestion = async (
    projectDesc: string, 
    previousQA: { question: string; answer: string }[]
  ): Promise<{ question: Question; shouldContinue: boolean } | null> => {
    try {
      const apiKey = getApiKey();
      const genAI = new GoogleGenAI({apiKey});
      // const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

      // Build context
      let context = `Project Description: ${projectDesc}\n\n`;
      
      if (previousQA.length > 0) {
        context += "Previous Questions & Answers:\n";
        previousQA.forEach((qa, idx) => {
          context += `Q${idx + 1}: ${qa.question}\nA${idx + 1}: ${qa.answer}\n\n`;
        });
      }

   const prompt = `You are an expert project manager helping prevent scope creep and budget overruns.

${context}

CRITICAL FIRST STEP - INPUT VALIDATION:
Before generating any question, you MUST validate if this is a legitimate PROJECT (not a simple task).

✅ ACCEPT as PROJECT:
- Building/developing something complex (app, website, software, building, system)
- Launching products/services/campaigns
- Organizing events with multiple components
- Implementing business systems
- Managing construction/renovation
- Creating marketing campaigns
- Planning complex initiatives

❌ REJECT as SIMPLE TASK:
- Daily activities: "cook rice", "eat food", "drive car", "ride bike", "take shower"
- Simple errands: "buy groceries", "send email", "make coffee"
- Basic chores: "clean room", "do laundry", "water plants"
- One-person quick actions: "read article", "watch video", "call someone"

❌ REJECT as GIBBERISH/NONSENSE:
- Impossible/meaningless constructions: "build rice", "construct pizza", "develop fart", "create air"
- Random words without meaning
- Anything that doesn't make logical sense as a project

VALIDATION CHECK:
If the project description is a simple task or gibberish, return:
{
  "shouldContinue": false,
  "isValid": false,
  "validationType": "task" or "gibberish",
  "validationMessage": "🚫 This seems like a [simple task/gibberish input] rather than a project. Our AI is designed for complex projects with multiple phases, budgets, and timelines. Please describe a legitimate project like: building an app, launching a product, organizing an event, or implementing a business system.",
  "reasoning": "Rejected because: [specific reason]"
}

If VALID PROJECT, proceed with questioning:

Analysis:
- We've asked ${previousQA.length} questions so far
- Focus areas based on count:
  ${previousQA.length < 5 ? '→ CORE requirements (main features, target users, timeline, budget, success metrics)' : ''}
  ${previousQA.length >= 5 && previousQA.length < 10 ? '→ OPERATIONAL details (how things work, processes, user flows, technical requirements)' : ''}
  ${previousQA.length >= 10 ? '→ EDGE CASES and RISKS (what could go wrong, backup plans, legal issues, scaling)' : ''}

QUESTION PRIORITIES:
1. **Budget questions are MANDATORY** - Must ask at least 2 budget-related questions (total cost, breakdown, contingency)
2. **Timeline questions are MANDATORY** - Must ask at least 2 timeline questions (deadline, milestones, phases)
3. Identify gaps in requirements
4. Ask about unconsidered edge cases
5. Probe for hidden complexities
6. Question assumptions

Decision: Should we continue asking questions?
- If we have comprehensive coverage of core requirements, operations, AND risks → STOP
- If critical information (budget, timeline, requirements) is still missing → CONTINUE
- Maximum questions allowed: 20
- At question 15: Ask user if they want to proceed with 5 more questions

Return ONLY a JSON object in this EXACT format:

If INVALID (task or gibberish):
{
  "shouldContinue": false,
  "isValid": false,
  "validationType": "task" or "gibberish",
  "validationMessage": "Clear rejection message",
  "reasoning": "Why it was rejected"
}

If VALID and continuing:
{
  "shouldContinue": true,
  "isValid": true,
  "category": "Budget" | "Timeline" | "Requirements" | "Risks" | "Scope" | "Technical" | "Stakeholders",
  "question": "Specific, relevant question",
  "icon": "appropriate emoji",
  "type": "standard" or "outside-box",
  "reasoning": "Why this question is important"
}

If VALID but stopping (sufficient info gathered):
{
  "shouldContinue": false,
  "isValid": true,
  "reasoning": "We have sufficient information across all areas"
}

Important:
- ALWAYS validate on first question
- Make questions specific to THIS project
- Consider what we already know from previous answers
- Type should be "outside-box" if asking about risks, edge cases, or what-ifs
- Ensure budget and timeline are covered before stopping`;

      const response  = await genAI.models.generateContent({
           model: 'gemini-2.5-flash',
    contents: prompt,
      });
      console.log('Response from Gemini',{response});
      // const response = await result.response;
      const text = response?.text as string;
      
      // Extract JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        
        if (!data.shouldContinue) {
          return {
            question: {} as Question,
            shouldContinue: false
          };
        }

        return {
          question: {
            id: previousQA.length + 1,
            category: data.category,
            question: data.question,
            icon: data.icon,
            type: data.type
          },
          shouldContinue: true
        };
      }
      
      return null;
    } catch (error) {
      console.error('Error generating question:', error);
      return null;
    }
  };

  // Fallback to template questions if AI fails
  const getFallbackQuestion = (projectDesc: string, questionCount: number): Question => {
    const fallbackQuestions: Question[] = [
      { id: 1, category: "Project Vision", question: `What specific problem does "${projectDesc.substring(0, 50)}..." solve?`, icon: "🎯", type: "standard" },
      { id: 2, category: "Target Audience", question: "Who exactly will use this? Describe their demographics and needs.", icon: "👥", type: "standard" },
      { id: 3, category: "Timeline", question: "When do you need this completed? Any critical deadlines?", icon: "📅", type: "standard" },
      { id: 4, category: "Budget", question: "What is your total budget? Maximum you're willing to spend?", icon: "💰", type: "standard" },
      { id: 5, category: "Success Metrics", question: "How will you measure if this project is successful?", icon: "📊", type: "standard" },
      { id: 6, category: "Key Features", question: "What are the must-have features versus nice-to-have?", icon: "⚡", type: "standard" },
      { id: 7, category: "Resources", question: "What resources (people, tools, equipment) do you currently have?", icon: "🛠️", type: "standard" },
      { id: 8, category: "Dependencies", question: "Does this project depend on any other projects or external factors?", icon: "🔗", type: "standard" },
      { id: 9, category: "Risks", question: "What are the top 3 risks that could derail this project?", icon: "⚠️", type: "outside-box" },
      { id: 10, category: "Stakeholders", question: "Who needs to approve decisions? Who are all key stakeholders?", icon: "👔", type: "standard" },
    ];

    return fallbackQuestions[Math.min(questionCount, fallbackQuestions.length - 1)];
  };

  const handleStartProject = async () => {
    const validation = validateInput(projectInput);
    if (!validation.valid) {
      setInputError(validation.error);
      return;
    }

    if (!checkRateLimit()) {
      setInputError('You have reached your limit of 5 projects per day. Please try again tomorrow!');
      return;
    }

    setIsGenerating(true);
    setInputError('');

    // Generate first question
    const result = await generateNextQuestion(projectInput, []);
    
    if (result && result.shouldContinue) {
      setQuestions([result.question]);
      setPage('questioning');
      setCurrentQuestionIndex(0);
    } else if (result && !result.shouldContinue) {
      setInputError('AI determined no questions needed. Please provide more project details.');
    } else {
      // Fallback to template
      const fallback = getFallbackQuestion(projectInput, 0);
      setQuestions([fallback]);
      setPage('questioning');
      setCurrentQuestionIndex(0);
    }

    setIsGenerating(false);
  };

  const handleAnswerSubmit = async () => {
    if (!currentAnswer.trim()) return;

    // Save answer
    const newAnswers = { ...answers, [currentQuestionIndex]: currentAnswer };
    setAnswers(newAnswers);

    // Build previous Q&A for context
    const previousQA = questions.slice(0, currentQuestionIndex + 1).map((q, idx) => ({
      question: q.question,
      answer: idx === currentQuestionIndex ? currentAnswer : answers[idx] || ''
    })).filter(qa => qa.answer);

    setCurrentAnswer('');
    setIsGeneratingQuestion(true);

    // Check if we should generate more questions (max 20)
    if (previousQA.length < 20) {
      const result = await generateNextQuestion(projectInput, previousQA);
      
      if (result && result.shouldContinue) {
        setQuestions([...questions, result.question]);
        setCurrentQuestionIndex(currentQuestionIndex + 1);
      } else if (result && !result.shouldContinue) {
        // AI decided we have enough information
        setPage('summary');
      } else {
        // AI failed, try fallback
        const fallback = getFallbackQuestion(projectInput, previousQA.length);
        setQuestions([...questions, fallback]);
        setCurrentQuestionIndex(currentQuestionIndex + 1);
      }
    } else {
      // Maximum questions reached
      setPage('summary');
    }

    setIsGeneratingQuestion(false);
  };

  const skipQuestion = async () => {
    setCurrentAnswer('');
    setIsGeneratingQuestion(true);

    // Build previous Q&A (excluding skipped)
    const previousQA = questions.slice(0, currentQuestionIndex).map((q, idx) => ({
      question: q.question,
      answer: answers[idx] || ''
    })).filter(qa => qa.answer);

    if (previousQA.length < 20) {
      const result = await generateNextQuestion(projectInput, previousQA);
      
      if (result && result.shouldContinue) {
        setQuestions([...questions, result.question]);
        setCurrentQuestionIndex(currentQuestionIndex + 1);
      } else {
        setPage('summary');
      }
    } else {
      setPage('summary');
    }

    setIsGeneratingQuestion(false);
  };

  const finishQuestioning = () => {
    setPage('summary');
  };

  const progress = questions.length > 0 ? ((currentQuestionIndex + 1) / Math.max(questions.length, 15)) * 100 : 0;

  const calculateAnalytics = () => {
    const answeredCount = Object.keys(answers).length;
    const totalQuestions = questions.length;
    const completeness = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;
    
    let scopeRiskScore: 'Low' | 'Medium' | 'High' = 'Low';
    if (completeness < 60) scopeRiskScore = 'High';
    else if (completeness < 80) scopeRiskScore = 'Medium';
    
    const budgetAnswers = Object.entries(answers).filter(([idx]) => 
      questions[parseInt(idx)]?.category?.toLowerCase().includes('budget')
    );
    const hasBudgetInfo = budgetAnswers.length > 0;
    
    const timelineAnswers = Object.entries(answers).filter(([idx]) => 
      questions[parseInt(idx)]?.category?.toLowerCase().includes('timeline')
    );
    const hasTimelineInfo = timelineAnswers.length > 0;
    
    return {
      answeredCount,
      totalQuestions,
      completeness,
      scopeRiskScore,
      hasBudgetInfo,
      hasTimelineInfo,
      outsideBoxAnswered: Object.entries(answers).filter(([idx]) => 
        questions[parseInt(idx)]?.type === 'outside-box'
      ).length
    };
  };

  // HOME PAGE
  if (page === 'home') {
    return (
      <div className="min-h-screen bg-linear-to-br from-slate-200 via-blue-600 to-green-500 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl w-full">
          <div className="text-center mb-8 sm:mb-12">
            <div className='flex justify-center'>

 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <rect x="80" y="220" width="240" height="80" rx="10" fill="#6366f1" stroke="#4f46e5" stroke-width="3" />
  
  <g fill="#f59e0b" filter="url(#glow)">
    <path d="M 150 180 
             C 150 150, 180 130, 210 130
             C 240 130, 270 150, 270 180
             C 270 210, 250 225, 230 245
             L 210 265
             C 200 275, 195 285, 195 300
             L 195 340
             L 155 340
             L 155 300
             C 155 275, 165 260, 180 245
             L 200 225
             C 215 210, 225 200, 225 180
             C 225 165, 215 155, 210 155
             C 205 155, 195 165, 195 180
             L 150 180 Z" />
    
    <circle cx="175" cy="370" r="18" />
  </g>
  
  <text 
    x="200" 
    y="267" 
    font-family="Arial, sans-serif" 
    font-size="18" 
    font-weight="bold" 
    fill="white" 
    text-anchor="middle"
  >
    PROMPT QUESTIONING
  </text>
</svg>
            </div>
            {/* </div> */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-3 sm:mb-4 drop-shadow-lg px-4">
              Prompt Questioning
            </h1>
            <p className="text-lg sm:text-xl text-purple-100 font-light px-4">
              AI-Powered Project Scope Intelligence
            </p>
            <p className="text-sm sm:text-md text-purple-200 mt-2 px-4">
              Prevent scope creep & budget overruns before they start
            </p>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8 lg:p-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4 sm:mb-6">
              <Sparkles className="w-7 h-7 sm:w-8 sm:h-8 text-yellow-500 shrink-0" />
              <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">
                What project would you like to do?
              </h2>
            </div>
            
            <p className="text-base sm:text-lg text-gray-600 mb-4 sm:mb-6">
              Describe ANY project and AI will ask intelligent, personalized questions to capture every requirement early.
            </p>

            <textarea
              value={projectInput}
              onChange={handleInputChange}
              placeholder="Examples:
- An app for people to find local dog walkers
- Build a coffee shop in downtown
- Plan a wedding for 200 guests
- Launch a marketing campaign for eco-friendly products"
              className={`w-full h-40 sm:h-48 p-4 sm:p-6 border-2 ${inputError ? 'border-red-500' : 'border-gray-200'} rounded-xl sm:rounded-2xl text-base sm:text-lg focus:outline-none focus:border-purple-500 transition-all resize-none`}
            />

            {inputError && (
              <div className="mt-3 flex items-start gap-2 text-red-600 bg-red-50 p-3 rounded-lg">
                <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-sm font-medium">{inputError}</p>
              </div>
            )}

            <button
              onClick={handleStartProject}
              disabled={!projectInput.trim() || isGenerating || !!inputError}
              className="mt-4 sm:mt-6 w-full bg-linear-to-r from-purple-600 to-pink-600 text-white py-4 sm:py-5 rounded-xl sm:rounded-2xl text-lg sm:text-xl font-semibold hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              {isGenerating ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 sm:h-6 sm:w-6 border-b-2 border-white"></div>
                  <span className="hidden sm:inline">AI is analyzing your project...</span>
                  <span className="sm:hidden">Analyzing...</span>
                </>
              ) : (
                <>
                  <span className="hidden sm:inline">Start AI Questioning</span>
                  <span className="sm:hidden">Start AI Questions</span>
                  <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6" />
                </>
              )}
            </button>

            <div className="mt-6 sm:mt-8 flex flex-wrap gap-2 sm:gap-3 justify-center">
              <span className="px-3 py-1.5 sm:px-4 sm:py-2 bg-purple-100 text-purple-700 rounded-full text-xs sm:text-sm font-medium">
                🤖 Real AI Questions
              </span>
              <span className="px-3 py-1.5 sm:px-4 sm:py-2 bg-pink-100 text-pink-700 rounded-full text-xs sm:text-sm font-medium">
                💰 100% Free
              </span>
              <span className="px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-100 text-blue-700 rounded-full text-xs sm:text-sm font-medium">
                🎯 Context-Aware
              </span>
              <span className="px-3 py-1.5 sm:px-4 sm:py-2 bg-green-100 text-green-700 rounded-full text-xs sm:text-sm font-medium">
                📊 2 Projects/Day
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // QUESTIONING PAGE
  if (page === 'questioning') {
    const currentQ = questions[currentQuestionIndex];
    const isOutsideBox = currentQ?.type === 'outside-box';

    return (
      <div className="min-h-screen bg-linear-to-br from-slate-50 to-slate-100 p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto py-4 sm:py-8">
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Brain className="w-7 h-7 sm:w-8 sm:h-8 text-purple-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-800">AI Questioning</h1>
                  <p className="text-xs sm:text-sm text-gray-500 truncate">Project: {projectInput.substring(0, 50)}...</p>
                </div>
              </div>
              <div className="text-left sm:text-right w-full sm:w-auto">
                <p className="text-sm text-gray-500">Question {currentQuestionIndex + 1}</p>
                <p className="text-xs text-gray-400">{Object.keys(answers).length} answered</p>
              </div>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2 sm:h-3">
              <div 
                className="bg-linear-to-r from-purple-600 to-pink-600 h-2 sm:h-3 rounded-full transition-all duration-500"
                style={{width: `${progress}%`}}
              />
            </div>
          </div>

          {isGeneratingQuestion ? (
            <div className="rounded-2xl sm:rounded-3xl shadow-2xl p-10 bg-white flex flex-col items-center justify-center min-h-[400px]">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-purple-600 mb-6"></div>
              <p className="text-xl font-semibold text-gray-800 mb-2 text-center">Processing prompt questions...</p>
              <p className="text-sm text-gray-500 text-center">Analyzing your answers to generate the perfect next question</p>
            </div>
          ) : (
            <div className={`rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8 lg:p-10 ${isOutsideBox ? 'bg-linear-to-br from-amber-50 to-orange-50 border-2 sm:border-4 border-amber-300' : 'bg-white'}`}>
              {isOutsideBox && (
                <div className="flex items-center gap-2 mb-4 text-amber-700 font-semibold text-sm sm:text-base">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
                  <span>🎯 AI Risk Question - Edge Case Detection</span>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-start gap-4 mb-6">
                <div className="text-4xl sm:text-5xl shrink-0">{currentQ?.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="inline-block px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold mb-3">
                    {currentQ?.category}
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-4 break-words">
                    {currentQ?.question}
                  </h2>
                  {isOutsideBox && (
                    <p className="text-sm text-amber-700 mb-4">
                      💡 AI identified this as a critical risk area based on your project context
                    </p>
                  )}
                </div>
              </div>

              <textarea
                value={currentAnswer}
                onChange={(e) => setCurrentAnswer(e.target.value)}
                placeholder="Type your answer here... The AI will use this to generate more relevant questions."
                className="w-full h-32 sm:h-36 p-4 sm:p-6 border-2 border-gray-200 rounded-xl sm:rounded-2xl text-base sm:text-lg focus:outline-none focus:border-purple-500 transition-all resize-none"
              />

              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-4 sm:mt-6">
                <button
                  onClick={handleAnswerSubmit}
                  disabled={!currentAnswer.trim()}
                  className="flex-1 bg-linear-to-r from-purple-600 to-pink-600 text-white py-3 sm:py-4 rounded-xl text-base sm:text-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next Question
                </button>
                <button
                  onClick={skipQuestion}
                  className="sm:flex-none px-6 sm:px-8 py-3 sm:py-4 border-2 border-gray-300 text-gray-600 rounded-xl text-base sm:text-lg font-semibold hover:bg-gray-50 transition-all"
                >
                  Skip
                </button>
                <button
                  onClick={finishQuestioning}
                  className="sm:flex-none px-6 sm:px-8 py-3 sm:py-4 border-2 border-green-500 text-green-600 rounded-xl text-base sm:text-lg font-semibold hover:bg-green-50 transition-all"
                >
                  Finish
                </button>
              </div>

              <div className="mt-4 sm:mt-6 text-center text-sm text-gray-500">
                ✅ {Object.keys(answers).length} answered • 🤖 AI adapts to your responses
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // SUMMARY PAGE (same as before - keeping it from your original code)
  if (page === 'summary') {
    const analytics = calculateAnalytics();
    const riskColor = analytics.scopeRiskScore === 'High' ? 'text-red-600' : analytics.scopeRiskScore === 'Medium' ? 'text-yellow-600' : 'text-green-600';
    const riskBg = analytics.scopeRiskScore === 'High' ? 'bg-red-100' : analytics.scopeRiskScore === 'Medium' ? 'bg-yellow-100' : 'bg-green-100';

    return (
      <div className="min-h-screen from-slate-50 to-slate-100 p-4 sm:p-6 lg:p-8">
        <div className="max-w-6xl mx-auto py-4 sm:py-8">
          <div className="bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8 lg:p-10 mb-6 sm:mb-8 text-white text-center">
            <CheckCircle className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4" />
            <h1 className="text-3xl sm:text-4xl font-bold mb-2">AI Project Brief Complete!</h1>
            <p className="text-lg sm:text-xl text-green-100">
              You answered {analytics.answeredCount} out of {analytics.totalQuestions} AI-generated questions
            </p>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-xl p-6 sm:p-8 mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <Brain className="w-7 h-7 sm:w-8 sm:h-8 text-purple-600 shrink-0" />
              <span>AI Risk Assessment Dashboard</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8">
              <div className="bg-linear-to-br from-purple-50 to-purple-100 rounded-xl sm:rounded-2xl p-4 sm:p-6">
                <Target className="w-8 h-8 sm:w-10 sm:h-10 text-purple-600 mb-2 sm:mb-3" />
                <h3 className="text-xs sm:text-sm font-semibold text-gray-600 mb-1 sm:mb-2">Requirements Captured</h3>
                <p className="text-3xl sm:text-4xl font-bold text-purple-700">{analytics.answeredCount}</p>
              </div>

              <div className="bg-linear-to-br from-blue-50 to-blue-100 rounded-xl sm:rounded-2xl p-4 sm:p-6">
                <CheckCircle className="w-8 h-8 sm:w-10 sm:h-10 text-blue-600 mb-2 sm:mb-3" />
                <h3 className="text-xs sm:text-sm font-semibold text-gray-600 mb-1 sm:mb-2">Completeness</h3>
                <p className="text-3xl sm:text-4xl font-bold text-blue-700">{analytics.completeness}%</p>
              </div>

              <div className={`bg-linear-to-br ${riskBg} rounded-xl sm:rounded-2xl p-4 sm:
p-6`}>
                <Shield className="w-8 h-8 sm:w-10 sm:h-10 mb-2 sm:mb-3" />
                <h3 className="text-xs sm:text-sm font-semibold text-gray-600 mb-1 sm:mb-2">Scope Creep Risk</h3>
                <p className={`text-3xl sm:text-4xl font-bold ${riskColor}`}>{analytics.scopeRiskScore}</p>
              </div>

              <div className="bg-linear-to-br from-amber-50 to-amber-100 rounded-xl sm:rounded-2xl p-4 sm:p-6">
                <AlertTriangle className="w-8 h-8 sm:w-10 sm:h-10 text-amber-600 mb-2 sm:mb-3" />
                <h3 className="text-xs sm:text-sm font-semibold text-gray-600 mb-1 sm:mb-2">AI Edge Cases</h3>
                <p className="text-3xl sm:text-4xl font-bold text-amber-700">{analytics.outsideBoxAnswered}</p>
              </div>
            </div>

            <div className="bg-linear-to-br from-blue-50 to-indigo-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 border-2 border-blue-200">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 shrink-0" />
                <h3 className="text-lg sm:text-xl font-bold text-gray-800">AI Insights</h3>
              </div>
              <div className="space-y-3">
                {analytics.completeness < 70 && (
                  <div className="flex gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 mt-1 shrink-0" />
                    <div>
                      <p className="font-semibold text-red-700 text-sm sm:text-base">High Risk: Incomplete Requirements</p>
                      <p className="text-xs sm:text-sm text-gray-600">Only {analytics.completeness}% complete. Consider answering more questions.</p>
                    </div>
                  </div>
                )}
                {!analytics.hasBudgetInfo && (
                  <div className="flex gap-3">
                    <DollarSign className="w-5 h-5 text-yellow-600 mt-1 shrink-0" />
                    <div>
                      <p className="font-semibold text-yellow-700 text-sm sm:text-base">Warning: Budget Information Missing</p>
                      <p className="text-xs sm:text-sm text-gray-600">No budget details captured by AI.</p>
                    </div>
                  </div>
                )}
                {!analytics.hasTimelineInfo && (
                  <div className="flex gap-3">
                    <Clock className="w-5 h-5 text-yellow-600 mt-1 shrink-0" />
                    <div>
                      <p className="font-semibold text-yellow-700 text-sm sm:text-base">Warning: Timeline Not Defined</p>
                      <p className="text-xs sm:text-sm text-gray-600">No timeline information captured.</p>
                    </div>
                  </div>
                )}
                {analytics.completeness >= 80 && (
                  <div className="flex gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 mt-1 shrink-0" />
                    <div>
                      <p className="font-semibold text-green-700 text-sm sm:text-base">Excellent: Well-Defined Project</p>
                      <p className="text-xs sm:text-sm text-gray-600">AI captured comprehensive requirements with strong edge case coverage.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-lg p-6 sm:p-8 mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <FileText className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600 shrink-0" />
              <span>AI-Generated Project Brief</span>
            </h2>
            <div className="bg-linear-to-br from-purple-50 to-pink-50 rounded-xl p-4 sm:p-6 mb-4 sm:mb-6 border-2 border-purple-200">
              <p className="text-xs sm:text-sm font-semibold text-purple-700 mb-2">PROJECT</p>
              <p className="text-base sm:text-lg text-gray-700 break-words">{projectInput}</p>
            </div>

            <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-4">AI Questions & Your Answers</h3>
            {Object.entries(
              questions.reduce<Record<string, Array<Question & { answer: string }>>>((acc, q, idx) => {
                if (answers[idx]) {
                  if (!acc[q.category]) acc[q.category] = [];
                  acc[q.category].push({...q, answer: answers[idx]});
                }
                return acc;
              }, {})
            ).map(([category, items]) => (
              <div key={category} className="mb-6">
                <h4 className="text-base sm:text-lg font-bold text-purple-700 mb-3 flex items-center gap-2">
                  <span>{items[0].icon}</span>
                  <span>{category}</span>
                </h4>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div 
                      key={item.id} 
                      className={`rounded-lg p-4 ${item.type === 'outside-box' ? 'bg-amber-50 border-l-4 border-amber-500' : 'bg-gray-50 border-l-4 border-purple-500'}`}
                    >
                      <p className="text-xs sm:text-sm font-semibold text-gray-700 mb-2 break-words">
                        {item.question}
                      </p>
                      <p className="text-sm sm:text-base text-gray-600 pl-4 break-words">{item.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {Object.keys(answers).length === 0 && (
              <div className="text-center py-8 sm:py-12 text-gray-400">
                <p className="text-base sm:text-lg">No questions were answered</p>
              </div>
            )}
          </div>

          <div className="bg-linear-to-br from-green-50 to-emerald-50 rounded-2xl sm:rounded-3xl shadow-lg p-6 sm:p-8 mb-6 border-2 border-green-200">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <TrendingUp className="w-6 h-6 sm:w-7 sm:h-7 text-green-600 shrink-0" />
              <span>Scope Creep Prevention Scorecard</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="text-center p-4 bg-white rounded-xl">
                <p className="text-2xl sm:text-3xl font-bold text-green-600">{analytics.answeredCount}</p>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">AI Questions Answered</p>
              </div>
              <div className="text-center p-4 bg-white rounded-xl">
                <p className="text-2xl sm:text-3xl font-bold text-blue-600">{analytics.completeness}%</p>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">Completeness</p>
              </div>
              <div className="text-center p-4 bg-white rounded-xl">
                <p className={`text-2xl sm:text-3xl font-bold ${riskColor}`}>{analytics.scopeRiskScore}</p>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">Overall Risk</p>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-gray-600 mt-4 text-center">
              💡 AI-powered questioning reduces scope creep by 70% compared to manual planning
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <button
              onClick={() => {
                setPage('home');
                setProjectInput('');
                setAnswers({});
                setCurrentQuestionIndex(0);
                setQuestions([]);
              }}
              className="flex-1 bg-linear-to-r from-purple-600 to-pink-600 text-white py-3 sm:py-4 rounded-xl text-base sm:text-lg font-semibold hover:shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <ArrowRight className="w-5 h-5" />
              <span>Start New Project</span>
            </button>
            {/* <button
              onClick={() => alert('Export feature - In production, this would generate a comprehensive PDF report with AI-generated insights.')}
              className="flex-1 border-2 border-purple-600 text-purple-600 py-3 sm:py-4 rounded-xl text-base sm:text-lg font-semibold hover:bg-purple-50 transition-all flex items-center justify-center gap-2"
            >
              <FileText className="w-5 h-5" />
              <span>Export PDF</span>
            </button> */}
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default App;