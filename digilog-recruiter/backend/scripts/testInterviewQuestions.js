const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Interview = require('../models/Interview');
const InterviewQuestion = require('../models/InterviewQuestion');
const interviewQuestionEmailService = require('../services/interviewQuestionEmailService');

// Load environment variables
dotenv.config({ path: '../.env' });

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

const testInterviewQuestions = async () => {
  try {
    await connectDB();
    
    console.log('🔍 Testing Interview Questions System...\n');
    
    // 1. Find interviews with questions enabled
    const interviews = await Interview.find({
      'notifications.sendQuestionsToInterviewers': true
    })
    .populate('candidateId')
    .populate('jobId')
    .populate('notifications.selectedQuestions')
    .limit(5);
    
    console.log(`📊 Found ${interviews.length} interviews with questions enabled\n`);
    
    for (const interview of interviews) {
      console.log(`\n📋 Interview ${interview._id}:`);
      console.log(`  - Candidate: ${interview.candidateId?.firstName} ${interview.candidateId?.lastName}`);
      console.log(`  - Job: ${interview.jobId?.title || 'N/A'}`);
      console.log(`  - Scheduled: ${interview.scheduledAt}`);
      console.log(`  - Send Questions: ${interview.notifications?.sendQuestionsToInterviewers}`);
      console.log(`  - Send Time: ${interview.notifications?.questionsSendTime} minutes before`);
      console.log(`  - Questions Sent At: ${interview.notifications?.questionsSentAt || 'Not sent yet'}`);
      console.log(`  - Selected Questions Count: ${interview.notifications?.selectedQuestions?.length || 0}`);
      
      if (interview.notifications?.selectedQuestions?.length > 0) {
        console.log('  - Questions:');
        interview.notifications.selectedQuestions.forEach((q, i) => {
          console.log(`    ${i + 1}. ${q?.question || 'Question data not populated'}`);
        });
      }
    }
    
    // 2. Test the background service check
    console.log('\n\n🔄 Testing background service check...');
    await interviewQuestionEmailService.checkAndSendQuestionEmails();
    
    // 3. Test sending questions for a specific interview (if you have an ID)
    const testInterviewId = process.argv[2]; // Pass interview ID as argument
    if (testInterviewId) {
      console.log(`\n\n📧 Testing manual send for interview ${testInterviewId}...`);
      
      const testInterview = await Interview.findById(testInterviewId)
        .populate('candidateId')
        .populate('jobId')
        .populate('notifications.selectedQuestions');
      
      if (testInterview) {
        const result = await interviewQuestionEmailService.sendQuestionEmail(testInterview);
        console.log('Send result:', result);
      } else {
        console.log('Interview not found');
      }
    }
    
    console.log('\n✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('📤 Database connection closed');
    process.exit(0);
  }
};

// Run the test
testInterviewQuestions();
