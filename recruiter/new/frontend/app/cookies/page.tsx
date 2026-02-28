'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronLeft, Cookie, ShieldCheck, FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CookiesPolicy() {
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
          <Cookie className="w-8 h-8 text-blue-400 mr-3" />
          <h1 className="text-3xl md:text-4xl font-bold">Cookie Policy</h1>
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
              <ShieldCheck className="w-5 h-5 text-blue-400 mr-2" />
              <p className="font-medium">Understanding how we use cookies.</p>
            </div>
            <p className="text-slate-300 text-sm">
              This Cookie Policy explains how SmartHR uses cookies and similar technologies to recognize you when you visit our platform. 
              It explains what these technologies are and why we use them, as well as your rights to control our use of them.
            </p>
          </div>

          <h2>1. What Are Cookies?</h2>
          <p>
            Cookies are small data files that are placed on your computer or mobile device when you visit a website. 
            Cookies are widely used by website owners to make their websites work, or to work more efficiently, as well 
            as to provide reporting information.
          </p>
          <p>
            Cookies set by the website owner (in this case, SmartHR) are called "first-party cookies." Cookies set by parties 
            other than the website owner are called "third-party cookies." Third-party cookies enable third-party features or 
            functionality to be provided on or through the website (e.g., advertising, interactive content, and analytics).
          </p>

          <h2>2. Types of Cookies We Use</h2>
          <p>
            We use the following types of cookies:
          </p>
          
          <h3>2.1. Essential Cookies</h3>
          <p>
            These cookies are necessary for the website to function and cannot be switched off in our systems. They are usually 
            only set in response to actions made by you which amount to a request for services, such as setting your privacy preferences, 
            logging in, or filling in forms. You can set your browser to block or alert you about these cookies, but some parts of the 
            site will not work if you block these cookies.
          </p>
          
          <h3>2.2. Performance and Analytics Cookies</h3>
          <p>
            These cookies allow us to count visits and traffic sources so we can measure and improve the performance of our site. 
            They help us to know which pages are the most and least popular and see how visitors move around the site. All information 
            these cookies collect is aggregated and anonymous. If you do not allow these cookies we will not know when you have visited 
            our site.
          </p>
          
          <h3>2.3. Functional Cookies</h3>
          <p>
            These cookies enable the website to provide enhanced functionality and personalization. They may be set by us or by third 
            party providers whose services we have added to our pages. If you do not allow these cookies then some or all of these 
            services may not function properly.
          </p>
          
          <h3>2.4. Targeting Cookies</h3>
          <p>
            These cookies may be set through our site by our advertising partners. They may be used by those companies to build a profile 
            of your interests and show you relevant advertisements on other sites. They do not directly store personal information, but 
            are based on uniquely identifying your browser and internet device. If you do not allow these cookies, you will experience 
            less targeted advertising.
          </p>

          <h2>3. How to Manage Cookies</h2>
          <p>
            You can set or amend your web browser controls to accept or refuse cookies. If you choose to reject cookies, you may still 
            use our website though your access to some functionality and areas of our website may be restricted. As the means by which 
            you can refuse cookies through your web browser controls vary from browser-to-browser, you should visit your browser's help 
            menu for more information.
          </p>
          <p>
            Most advertising networks offer you a way to opt out of targeted advertising. If you would like to find out more information, 
            please visit <a href="http://www.aboutads.info/choices/" target="_blank" rel="noopener noreferrer">http://www.aboutads.info/choices/</a> or 
            <a href="http://www.youronlinechoices.com" target="_blank" rel="noopener noreferrer" className="ml-1">http://www.youronlinechoices.com</a>.
          </p>

          <h2>4. Third-Party Cookies</h2>
          <p>
            We use cookies provided by trusted third parties. The following section details which third party cookies you might encounter 
            through this site:
          </p>
          <ul>
            <li>
              <strong>Analytics</strong>: We use Google Analytics which uses cookies to help us understand how you use the site and ways to improve your 
              experience. These cookies may track things such as how long you spend on the site and the pages that you visit.
            </li>
            <li>
              <strong>Payment Processing</strong>: Payment processors use cookies to prevent fraud and ensure the security of transactions.
            </li>
            <li>
              <strong>Customer Support</strong>: Our customer support tools may use cookies to recognize users and provide enhanced support features.
            </li>
            <li>
              <strong>Social Media</strong>: We also use social media buttons and plugins on this site that allow you to connect with your social network. 
              These social media platforms may set their own cookies through our site for analytics or advertising purposes.
            </li>
          </ul>

          <h2>5. Cookie Consent</h2>
          <p>
            When you first visit our website, we will ask for your consent to use cookies. You can choose to accept or decline cookies. 
            If you choose to decline, some aspects of the site may not work as intended or may not work at all.
          </p>
          <p>
            You can change your cookie preferences at any time by clicking on the "Cookie Settings" option in the footer of our website.
          </p>

          <h2>6. Updates to Cookie Policy</h2>
          <p>
            We may update this Cookie Policy from time to time to reflect changes in technology, regulation, or our business practices. 
            Any changes will become effective when we post the revised Cookie Policy on our website. We encourage you to periodically 
            review this page for the latest information on our cookie practices.
          </p>

          <h2>7. Contact Information</h2>
          <p>
            If you have any questions or concerns about our use of cookies or this Cookie Policy, please contact us at:
          </p>
          <p className="mb-8">
            <strong>Email:</strong> privacy@smarthr.com<br />
            <strong>Address:</strong> 123 Tech Avenue, Suite 400, San Francisco, CA 94107, USA<br />
            <strong>Phone:</strong> +1 (555) 123-4567
          </p>

          <div className="flex items-center p-4 bg-blue-500/10 rounded-lg border border-blue-500/20 mb-8">
            <FileCheck className="w-5 h-5 text-blue-400 mr-3 flex-shrink-0" />
            <p className="text-sm">
              By continuing to use our website, you consent to the use of cookies as described in this Cookie Policy. 
              If you have any questions about our use of cookies, please contact us.
            </p>
          </div>
        </motion.div>
      </main>

      <footer className="container mx-auto px-4 py-8 border-t border-white/10 mt-16">
        <div className="flex flex-col md:flex-row items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className="text-slate-300 hover:text-white transition-colors">Home</Link>
            <Link href="/terms" className="text-slate-300 hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/privacy" className="text-slate-300 hover:text-white transition-colors">Privacy Policy</Link>
          </div>
          <p className="text-slate-400 text-sm mt-4 md:mt-0">© 2025 SmartHR. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
