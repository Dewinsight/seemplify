'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, Plus, Minus } from 'lucide-react';
import * as Accordion from '@radix-ui/react-accordion';
import ScrollReveal from '@/components/animations/ScrollReveal';
import GlassmorphicCard from '@/components/ui/glassmorphic-card';
import { useBrandConfig } from '@/context/BrandContext';

const faqs = [
  {
    question: "How does AI candidate matching work?",
    answer: "Our AI analyzes thousands of data points from resumes, portfolios, and job descriptions to identify the best matches. The algorithm considers technical skills, soft skills, experience level, culture fit, and more, achieving 95.8% accuracy."
  },
  {
    question: "Is there a free trial available?",
    answer: "Yes! We offer a 14-day free trial with full access to all features. No credit card required to start. You can test the platform with real candidates and jobs to see the value firsthand."
  },
  {
    question: "How long does it take to set up?",
    answer: "Most companies are up and running in under 30 minutes. Our onboarding wizard guides you through adding your first job, uploading candidates, and configuring your team. Plus, we offer white-glove setup assistance for enterprise clients."
  },
  {
    question: "What integrations do you support?",
    answer: "We integrate with popular calendar platforms (Google Calendar, Outlook), email services, Slack, Microsoft Teams, and various ATS systems. We also offer a robust API for custom integrations."
  },
  {
    question: "Is my data secure?",
    answer: "Absolutely. We use enterprise-grade encryption, are SOC 2 Type II compliant, and follow GDPR and CCPA regulations. Your data is hosted on secure, redundant servers with regular backups."
  },
  {
    question: "Can I customize the interview process?",
    answer: "Yes! You can create custom interview stages, define your own evaluation criteria, customize feedback forms, and set up automated workflows that match your unique hiring process."
  }
];

export const FAQSection: React.FC = () => {
  const brand = useBrandConfig();
  const [openItems, setOpenItems] = React.useState<string[]>([]);

  return (
    <section className="relative z-10 container mx-auto px-4 py-24 md:py-32">
      <ScrollReveal>
        <div className="text-center mb-16">
          <motion.span 
            className="inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/20 text-blue-300 text-sm font-semibold mb-6"
            whileHover={{ scale: 1.05 }}
          >
            <HelpCircle className="w-4 h-4 mr-2" />
            Frequently Asked Questions
          </motion.span>
          
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-black mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-100 to-cyan-100">
            Got Questions? We've Got Answers
          </h2>
          
          <p className="text-slate-300 text-xl max-w-3xl mx-auto">
            Everything you need to know about {brand.name}
          </p>
        </div>
      </ScrollReveal>

      <div className="max-w-4xl mx-auto">
        <GlassmorphicCard variant="default" className="p-2 md:p-4" hover={false}>
          <Accordion.Root 
            type="multiple" 
            value={openItems}
            onValueChange={setOpenItems}
            className="space-y-2"
          >
            {faqs.map((faq, index) => (
              <ScrollReveal key={index} delay={index * 0.1}>
                <Accordion.Item value={`item-${index}`} className="border-0">
                  <Accordion.Header>
                    <Accordion.Trigger className="group w-full text-left p-6 rounded-xl bg-white/5 hover:bg-white/10 transition-all duration-300 border border-white/10 hover:border-white/20">
                      <div className="flex items-center justify-between">
                        <span className="text-lg md:text-xl font-semibold text-white pr-4">
                          {faq.question}
                        </span>
                        <motion.div
                          animate={{ rotate: openItems.includes(`item-${index}`) ? 180 : 0 }}
                          transition={{ duration: 0.3 }}
                        >
                          {openItems.includes(`item-${index}`) ? (
                            <Minus className="w-5 h-5 text-purple-400 flex-shrink-0" />
                          ) : (
                            <Plus className="w-5 h-5 text-purple-400 flex-shrink-0" />
                          )}
                        </motion.div>
                      </div>
                    </Accordion.Trigger>
                  </Accordion.Header>
                  
                  <Accordion.Content className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
                    <div className="px-6 pb-6 pt-4">
                      <p className="text-slate-300 text-lg leading-relaxed">
                        {faq.answer}
                      </p>
                    </div>
                  </Accordion.Content>
                </Accordion.Item>
              </ScrollReveal>
            ))}
          </Accordion.Root>
        </GlassmorphicCard>
      </div>
    </section>
  );
};

export default FAQSection;
