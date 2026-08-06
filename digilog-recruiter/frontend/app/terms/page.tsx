'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronLeft, Shield, Scale, FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <Link href="/" className="flex items-center group">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center shadow-lg group-hover:shadow-blue-500/20 transition-all duration-300">
              <span className="font-extrabold text-white text-xs">HR</span>
            </div>
            <span className="ml-3 text-lg font-bold text-white">SmartHR</span>
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
          <Scale className="w-8 h-8 text-blue-400 mr-3" />
          <h1 className="text-3xl md:text-4xl font-bold">Terms of Service</h1>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="prose prose-invert max-w-none prose-headings:text-white prose-a:text-blue-400"
        >
          <p className="text-lg text-slate-300 mb-8">
            Last updated: October 9, 2025
          </p>
          
          <div className="bg-white/5 p-4 rounded-lg border border-white/10 mb-8">
            <div className="flex items-center mb-2">
              <FileCheck className="w-5 h-5 text-blue-400 mr-2" />
              <p className="font-medium">Please read these terms carefully before using our services.</p>
            </div>
            <p className="text-slate-300 text-sm">
              By accessing or using SmartHR's platform and services, you agree to be bound by these Terms of Service. 
              If you do not agree to all the terms and conditions, you must not access or use our services.
            </p>
          </div>

          <h2>1. Service Description</h2>
          <p>
            SmartHR provides an AI-powered human resources management platform ("Service") that includes 
            recruitment, candidate matching, interview scheduling, and HR analytics features. These Terms govern 
            your access to and use of the Service.
          </p>

          <h2>2. User Registration and Accounts</h2>
          <p>
            2.1. To access certain features of the Service, you must register for an account. You agree to provide 
            accurate, current, and complete information during the registration process and to update such information 
            to keep it accurate, current, and complete.
          </p>
          <p>
            2.2. You are responsible for safeguarding the password that you use to access the Service and for any 
            activities or actions under your password. We encourage you to use "strong" passwords (passwords that 
            use a combination of upper and lower case letters, numbers, and symbols) with your account.
          </p>
          <p>
            2.3. You agree not to disclose your password to any third party. You must notify us immediately upon 
            becoming aware of any breach of security or unauthorized use of your account.
          </p>

          <h2>3. Acceptable Use Policy</h2>
          <p>
            3.1. You may not use the Service for any purpose that is illegal or prohibited by these Terms, or to 
            solicit the performance of any illegal activity or other activity which infringes the rights of SmartHR 
            or others.
          </p>
          <p>
            3.2. You may not use the Service in any manner that could damage, disable, overburden, or impair the Service 
            or interfere with any other party's use of the Service.
          </p>
          <p>
            3.3. You agree not to reproduce, duplicate, copy, sell, resell or exploit any portion of the Service, use of 
            the Service, or access to the Service without the express written permission by SmartHR.
          </p>

          <h2>4. Intellectual Property Rights</h2>
          <p>
            4.1. The Service and its original content, features, and functionality are and will remain the exclusive 
            property of SmartHR and its licensors. The Service is protected by copyright, trademark, and other laws 
            of both the United States and foreign countries.
          </p>
          <p>
            4.2. Our trademarks and trade dress may not be used in connection with any product or service without the 
            prior written consent of SmartHR.
          </p>

          <h2>5. User Content</h2>
          <p>
            5.1. Our Service allows you to post, link, store, share and otherwise make available certain information, 
            text, graphics, videos, or other material ("User Content"). You are responsible for the User Content that 
            you post on or through the Service, including its legality, reliability, and appropriateness.
          </p>
          <p>
            5.2. By posting User Content on or through the Service, you represent and warrant that: (i) the User Content 
            is yours (you own it) or you have the right to use it and grant us the rights and license as provided in 
            these Terms, and (ii) the posting of your User Content on or through the Service does not violate the privacy 
            rights, publicity rights, copyrights, contract rights or any other rights of any person or entity.
          </p>
          <p>
            5.3. You retain any and all of your rights to any User Content you submit, post or display on or through 
            the Service and you are responsible for protecting those rights. We take no responsibility and assume no 
            liability for User Content you or any third party posts on or through the Service.
          </p>

          <h2>6. Payment Terms</h2>
          <p>
            6.1. Some aspects of the Service may be provided for a fee. You will be required to select a payment plan 
            and provide accurate payment information. You agree to pay all fees specified at the time of purchase.
          </p>
          <p>
            6.2. You authorize us to charge your payment method for all fees incurred. All fees are exclusive of all 
            taxes, levies, or duties imposed by taxing authorities, and you shall be responsible for payment of all 
            such taxes, levies, or duties.
          </p>
          <p>
            6.3. Subscription fees are non-refundable except as required by law or as explicitly stated in these Terms.
          </p>

          <h2>7. Termination</h2>
          <p>
            7.1. We may terminate or suspend your account and bar access to the Service immediately, without prior 
            notice or liability, under our sole discretion, for any reason whatsoever and without limitation, including 
            but not limited to a breach of the Terms.
          </p>
          <p>
            7.2. If you wish to terminate your account, you may simply discontinue using the Service, or contact us 
            for account deletion.
          </p>
          <p>
            7.3. All provisions of the Terms which by their nature should survive termination shall survive termination, 
            including, without limitation, ownership provisions, warranty disclaimers, indemnity and limitations of 
            liability.
          </p>

          <h2>8. Limitation Of Liability</h2>
          <p>
            8.1. In no event shall SmartHR, nor its directors, employees, partners, agents, suppliers, or affiliates, be 
            liable for any indirect, incidental, special, consequential or punitive damages, including without limitation, 
            loss of profits, data, use, goodwill, or other intangible losses, resulting from (i) your access to or use of 
            or inability to access or use the Service; (ii) any conduct or content of any third party on the Service; (iii) 
            any content obtained from the Service; and (iv) unauthorized access, use or alteration of your transmissions 
            or content, whether based on warranty, contract, tort (including negligence) or any other legal theory, whether 
            or not we have been informed of the possibility of such damage.
          </p>

          <h2>9. Governing Law and Dispute Resolution</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of [Jurisdiction], without regard 
            to its conflict of law provisions. Any dispute arising from or relating to the subject matter of these Terms 
            shall be finally settled by arbitration, using the English language in accordance with the [Arbitration Rules] 
            then in effect, by one or more commercial arbitrators.
          </p>

          <h2>10. Modifications to Terms</h2>
          <p>
            SmartHR reserves the right, at our sole discretion, to modify or replace these Terms at any time. If a 
            revision is material we will provide at least 30 days' notice prior to any new terms taking effect. What 
            constitutes a material change will be determined at our sole discretion.
          </p>

          <h2>11. Contact Information</h2>
          <p>
            If you have any questions about these Terms, please contact us at:
          </p>
          <p className="mb-8">
            <strong>Email:</strong> legal@smarthr.com<br />
            <strong>Address:</strong> 123 Tech Avenue, Suite 400, San Francisco, CA 94107, USA<br />
            <strong>Phone:</strong> +1 (555) 123-4567
          </p>

          <div className="flex items-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/20 mb-8">
            <Shield className="w-5 h-5 text-blue-400 mr-3 flex-shrink-0" />
            <p className="text-sm">
              By using SmartHR's services, you acknowledge that you have read these Terms of Service, 
              understood them, and agree to be bound by them. If you do not agree to these Terms of Service, 
              you are not authorized to use the Service.
            </p>
          </div>
        </motion.div>
      </main>

      <footer className="container mx-auto px-4 py-8 border-t border-white/10 mt-16">
        <div className="flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className="text-slate-300 hover:text-white transition-colors">Home</Link>
            <Link href="/privacy" className="text-slate-300 hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/cookies" className="text-slate-300 hover:text-white transition-colors">Cookie Policy</Link>
          </div>
          <p className="text-slate-400 text-sm mt-4 md:mt-0">© 2025 SmartHR. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
