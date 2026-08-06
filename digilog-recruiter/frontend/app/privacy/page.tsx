'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronLeft, Lock, Shield, FileCheck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <Link href="/" className="flex items-center group">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center shadow-lg group-hover:shadow-blue-500/20 transition-all duration-300">
              <span className="font-extrabold text-white text-xs">AI</span>
            </div>
            <span className="ml-3 text-lg font-bold text-white">AI in Nigeria</span>
          </Link>
          
          <Button
            variant="outline"
            className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30 flex items-center"
            asChild
          >
            <Link href="/">
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 flex items-center"
        >
          <Lock className="w-8 h-8 text-blue-400 mr-3" />
          <h1 className="text-3xl md:text-4xl font-bold">Privacy Policy</h1>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="prose prose-invert max-w-none prose-headings:text-white prose-a:text-blue-400"
        >
          <p className="text-lg text-slate-300 mb-8">
            Effective Date: 1st June, 2024
          </p>
          
          <div className="bg-white/5 p-4 rounded-lg border border-white/10 mb-8">
            <div className="flex items-center mb-2">
              <Shield className="w-5 h-5 text-blue-400 mr-2" />
              <p className="font-medium">Introduction</p>
            </div>
            <p className="text-slate-300 text-sm">
              At AI in Nigeria, we are committed to protecting your privacy and ensuring the security of your personal information. 
              This Privacy Policy outlines how we collect, use, disclose, and safeguard your information when you visit our website or use our services.
            </p>
          </div>

          <h2>1. Information We Collect</h2>
          <p>
            We may collect the following types of information:
          </p>
          <ul>
            <li>
              <strong>Personal Information</strong>: Name, email address, phone number, and other contact details.
            </li>
            <li>
              <strong>Technical Information</strong>: IP address, browser type, operating system, and other technical data.
            </li>
            <li>
              <strong>Usage Information</strong>: Pages viewed, links clicked, and other activities on our website.
            </li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <p>
            We use the information we collect for the following purposes:
          </p>
          <ul>
            <li><strong>Service Delivery</strong>: To provide, maintain, and improve our services, including AI Readiness Assessment and AI Education.</li>
            <li><strong>Communication</strong>: To send you updates, newsletters, and other information related to our services.</li>
            <li><strong>Personalization</strong>: To customize your experience and deliver content relevant to your interests.</li>
            <li><strong>Security</strong>: To protect our website and services from unauthorized access and misuse.</li>
            <li><strong>Analytics</strong>: To analyze usage patterns and improve our website and services.</li>
          </ul>

          <h2>3. Information Sharing and Disclosure</h2>
          <p>
            We do not sell, trade, or otherwise transfer your personal information to outside parties, except as described below:
          </p>
          <ul>
            <li>
              <strong>Service Providers</strong>: We may share your information with third-party service providers who assist us in operating our website and providing our services.
            </li>
            <li>
              <strong>Legal Requirements</strong>: We may disclose your information if required to do so by law or in response to valid requests by public authorities.
            </li>
          </ul>

          <h2>4. Data Security</h2>
          <p>
            We implement a variety of security measures to protect your personal information from unauthorized access, use, or disclosure. 
            However, no method of transmission over the internet or electronic storage is 100% secure, so we cannot guarantee absolute security.
          </p>

          <h2>5. Your Rights</h2>
          <p>
            You have the following rights regarding your personal information:
          </p>
          <ul>
            <li><strong>Access</strong>: You can request access to the personal information we hold about you.</li>
            <li><strong>Correction</strong>: You can request that we correct any inaccuracies in your personal information.</li>
            <li><strong>Deletion</strong>: You can request that we delete your personal information, subject to certain legal obligations.</li>
            <li><strong>Objection</strong>: You can object to the processing of your personal information for certain purposes.</li>
          </ul>

          <h2>6. Cookies and Tracking Technologies</h2>
          <p>
            We use cookies and similar tracking technologies to collect and store information about your interactions with our website. 
            You can control the use of cookies through your browser settings.
          </p>

          <h2>7. Changes to This Privacy Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated revision date. 
            We encourage you to review this Privacy Policy periodically to stay informed about how we are protecting your information.
          </p>

          <h2>8. Contact Us</h2>
          <p>
            If you have any questions or concerns about this Privacy Policy, please contact us at:
          </p>
          <p className="mb-8 bg-white/5 p-6 rounded-lg border border-white/10">
            <strong className="text-blue-400 text-lg block mb-3">AI in Nigeria</strong>
            <strong>Email:</strong> <a href="mailto:hello@aiinnigeria.com" className="text-blue-400 hover:text-blue-300">hello@aiinnigeria.com</a><br />
            <strong>Phone:</strong> +234 2014489258<br />
            <strong>Address:</strong> 7th floor, Mulliner Towers, 39 Alfred Rewane Rd, Ikoyi 101233, Lagos, Nigeria
          </p>

          <div className="flex items-center p-6 bg-blue-500/10 rounded-lg border border-blue-500/20 mb-8">
            <FileCheck className="w-5 h-5 text-blue-400 mr-3 flex-shrink-0" />
            <p className="text-sm">
              By using our website and services, you consent to the terms of this Privacy Policy. 
              Thank you for trusting AI in Nigeria with your personal information.
            </p>
          </div>
        </motion.div>
      </main>

      <footer className="container mx-auto px-4 py-8 border-t border-white/10 mt-16">
        <div className="flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className="text-slate-300 hover:text-white transition-colors">Home</Link>
            <Link href="/terms" className="text-slate-300 hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/cookies" className="text-slate-300 hover:text-white transition-colors">Cookie Policy</Link>
          </div>
          <p className="text-slate-400 text-sm mt-4 md:mt-0">© 2024 AI in Nigeria. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
