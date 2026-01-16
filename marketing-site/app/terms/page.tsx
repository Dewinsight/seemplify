import React from 'react';
import { FileText, Scale, AlertCircle, ShieldCheck, Users, Globe } from 'lucide-react';
import Link from 'next/link';

export default function TermsOfService() {
    const lastUpdated = "January 6, 2026";

    const sections = [
        {
            title: "Agreement to Terms",
            icon: <FileText className="w-5 h-5 text-blue-500" />,
            content: (
                <p>
                    These Terms of Service constitute a legally binding agreement made between you, whether personally or on behalf of an entity ("you")
                    and Seemplify ("we," "us," or "our"), concerning your access to and use of the Seemplify platform and related services.
                    By accessing the Services, you acknowledge that you have read, understood, and agreed to be bound by all of these Terms of Service.
                </p>
            )
        },
        {
            title: "Intellectual Property Rights",
            icon: <ShieldCheck className="w-5 h-5 text-emerald-500" />,
            content: (
                <p>
                    Unless otherwise indicated, the Site and Services are our proprietary property and all source code, databases, functionality,
                    software, website designs, audio, video, text, photographs, and graphics on the Site (collectively, the "Content") and the trademarks,
                    service marks, and logos contained therein (the "Marks") are owned or controlled by us or licensed to us, and are protected by
                    copyright and trademark laws.
                </p>
            )
        },
        {
            title: "User Representations",
            icon: <Users className="w-5 h-5 text-purple-500" />,
            content: (
                <div className="space-y-4">
                    <p>By using the Services, you represent and warrant that:</p>
                    <ul className="list-disc pl-5 space-y-2 text-zinc-600 dark:text-zinc-300">
                        <li>All registration information you submit will be true, accurate, current, and complete.</li>
                        <li>You will maintain the accuracy of such information and promptly update such registration information as necessary.</li>
                        <li>You have the legal capacity and you agree to comply with these Terms of Service.</li>
                        <li>You will not access the Services through automated or non-human means, whether through a bot, script, or otherwise.</li>
                    </ul>
                </div>
            )
        },
        {
            title: "Prohibited Activities",
            icon: <AlertCircle className="w-5 h-5 text-orange-500" />,
            content: (
                <p>
                    You may not access or use the Services for any purpose other than that for which we make the Services available.
                    The Services may not be used in connection with any commercial endeavors except those that are specifically endorsed or approved by us.
                    Systematic retrieval of data or other content from the Services to create or compile, directly or indirectly, a collection, compilation,
                    database, or directory without written permission from us is prohibited.
                </p>
            )
        },
        {
            title: "Governing Law",
            icon: <Scale className="w-5 h-5 text-rose-500" />,
            content: (
                <p>
                    These Terms shall be governed by and defined following the laws of the State of Delaware.
                    Seemplify and yourself irrevocably consent that the courts of Delaware shall have exclusive jurisdiction to resolve any dispute which may arise in connection with these terms.
                </p>
            )
        }
    ];

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 py-16 sm:py-24">
            {/* Background decoration */}
            <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                <div className="absolute top-0 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl animate-float"></div>
                <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }}></div>
            </div>

            <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">

                {/* Header */}
                <div className="text-center mb-16">
                    <div className="inline-flex items-center justify-center p-3 mb-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-lg shadow-zinc-200/50 dark:shadow-zinc-900/50 ring-1 ring-zinc-200 dark:ring-zinc-800">
                        <FileText className="w-8 h-8 text-emerald-600" />
                    </div>
                    <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-600 dark:from-white dark:to-zinc-400">
                        Terms of Service
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
