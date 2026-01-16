import React from 'react';
import { Shield, Lock, Eye, FileText, Mail, Server } from 'lucide-react';
import Link from 'next/link';

export default function PrivacyPolicy() {
    const lastUpdated = "January 6, 2026";

    const sections = [
        {
            title: "Introduction",
            icon: <FileText className="w-5 h-5 text-blue-500" />,
            content: (
                <p>
                    Welcome to Seemplify ("we," "our," or "us"). We are committed to protecting your personal information and your right to privacy.
                    When you use our HR ecosystem and related services, you trust us with your personal data. We take that trust seriously.
                    This privacy policy seeks to explain to you in the clearest way possible what information we collect, how we use it,
                    and what rights you have in relation to it.
                </p>
            )
        },
        {
            title: "Information We Collect",
            icon: <Eye className="w-5 h-5 text-emerald-500" />,
            content: (
                <div className="space-y-4">
                    <p>We collect personal information that you voluntarily provide to us when you register on the Services,
                        express an interest in obtaining information about us or our products and Services, when you participate in activities
                        on the Services, or otherwise when you contact us.</p>
                    <ul className="list-disc pl-5 space-y-2 text-zinc-600 dark:text-zinc-300">
                        <li><strong>Personal Identity Information:</strong> Name, contact details, job title, and company information.</li>
                        <li><strong>HR Data:</strong> Information related to your employment, performance reviews, and organizational role if applicable.</li>
                        <li><strong>Credentials:</strong> Passwords, password hints, and similar security information used for authentication.</li>
                    </ul>
                </div>
            )
        },
        {
            title: "How We Use Your Information",
            icon: <Server className="w-5 h-5 text-purple-500" />,
            content: (
                <p>
                    We use personal information collected via our Services for a variety of business purposes described below.
                    We process your personal information for these purposes in reliance on our legitimate business interests,
                    in order to enter into or perform a contract with you, with your consent, and/or for compliance with our legal obligations.
                    We use the information to manage user accounts, send administrative information to you, and protect our Services.
                </p>
            )
        },
        {
            title: "Data Security",
            icon: <Lock className="w-5 h-5 text-orange-500" />,
            content: (
                <p>
                    We have implemented appropriate technical and organizational security measures designed to protect the security of any
                    personal information we process. However, despite our safeguards and efforts to secure your information, no electronic
                    transmission over the Internet or information storage technology can be guaranteed to be 100% secure, so we cannot promise
                    or guarantee that hackers, cybercriminals, or other unauthorized third parties will not be able to defeat our security
                    and improperly collect, access, steal, or modify your information.
                </p>
            )
        },
        {
            title: "Contact Us",
            icon: <Mail className="w-5 h-5 text-rose-500" />,
            content: (
                <p>
                    If you have questions or comments about this policy, you may email us at <a href="mailto:privacy@seemplify.com" className="text-blue-600 hover:underline">privacy@seemplify.com</a> or by post to our corporate headquarters.
                </p>
            )
        }
    ];

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 py-16 sm:py-24">
            {/* Background decoration */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float"></div>
                <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }}></div>
            </div>

            <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* Header */}
                <div className="text-center mb-16">
                    <div className="inline-flex items-center justify-center p-3 mb-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-lg shadow-zinc-200/50 dark:shadow-zinc-900/50 ring-1 ring-zinc-200 dark:ring-zinc-800">
                        <Shield className="w-8 h-8 text-blue-600" />
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-600 dark:from-white dark:to-zinc-400">
                        Privacy Policy
                    </h1>
                    <p className="text-lg text-zinc-600 dark:text-zinc-400">
                        Last updated: {lastUpdated}
                    </p>
                </div>

                {/* Content Card */}
                <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl rounded-3xl shadow-xl ring-1 ring-zinc-200 dark:ring-zinc-800 p-8 sm:p-12 mb-12">
                    <div className="prose prose-zinc dark:prose-invert max-w-none">

                        {sections.map((section, index) => (
                            <div key={index} className="mb-10 last:mb-0">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
                                        {section.icon}
                                    </div>
                                    <h2 className="text-2xl font-semibold m-0">{section.title}</h2>
                                </div>
                                <div className="text-zinc-600 dark:text-zinc-300 leading-relaxed pl-0 sm:pl-[3.25rem]">
                                    {section.content}
                                </div>
                                {index !== sections.length - 1 && (
                                    <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-8 ml-0 sm:ml-[3.25rem]" />
                                )}
                            </div>
                        ))}

                    </div>
                </div>

                {/* Footer */}
                <div className="text-center text-zinc-500 dark:text-zinc-500 text-sm">
                    <p>
                        &copy; {new Date().getFullYear()} Seemplify. All rights reserved.
                    </p>
                    <div className="mt-2">
                        <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-300 transition-colors">
                            Back to Home
                        </Link>
                    </div>
                </div>

            </div>
        </div>
    );
}
