"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/services/apiConfig";
import { OTPVerification } from "@/components/auth/otp-verification";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  Shield,
  Users,
  Zap,
  Mail,
  Lock
} from "lucide-react";
import { useBrandConfig } from "@/context/BrandContext";

export default function SignupPage() {
  const router = useRouter();
  const auth = useAuth();
  const { toast } = useToast();
  const brand = useBrandConfig();
  const authShell =
    brand.authShellClass ?? 'bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900';
  const jet = brand.id === 'jetstone';
  const textColor = jet ? 'text-slate-800' : 'text-white';
  const textMuted = jet ? 'text-slate-600' : 'text-slate-300';
  const cardBg = jet ? 'bg-white/60 border-slate-200/50 shadow-xl' : 'bg-white/15 border-white/30 shadow-2xl';
  const featureBg = jet ? 'bg-white/40 border-slate-200/50 hover:bg-white/60' : 'bg-white/5 border-white/10 hover:bg-white/10';
  const linkBg = jet ? 'bg-white/50 border-slate-200/50 hover:bg-white/80 hover:border-slate-300/50' : 'bg-white/10 border-white/20 hover:bg-white/20 hover:border-white/30';
  const accentGrad = jet ? 'from-green-600 to-amber-600' : 'from-[#A284F1] via-[#754BE5] to-[#6935CF]';
  const btnGrad = jet ? 'bg-gradient-to-r from-green-700 to-green-900 hover:from-green-800 hover:to-green-950 focus:ring-2 focus:ring-green-400/50' : 'bg-gradient-to-r from-[#754BE5] to-[#6935CF] hover:from-[#6935CF] hover:to-[#5a2bb8] focus:ring-2 focus:ring-[#754BE5]/50';
  const iconGrad = jet ? 'bg-gradient-to-br from-green-500 to-amber-600' : 'bg-gradient-to-br from-blue-400 to-purple-500';
  const orb1 = jet ? 'bg-green-500/18' : 'bg-blue-500/20';
  const orb2 = jet ? 'bg-amber-400/18' : 'bg-purple-500/20';
  const orb3 = jet ? 'bg-yellow-400/14' : 'bg-pink-500/20';
  const particleColor = jet ? 'bg-green-400/40' : 'bg-blue-400/30';
  const mouseGlowColor = jet ? 'rgba(21,128,61,0.14)' : 'rgba(59,130,246,0.15)';
  const [isLoading, setIsLoading] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [showOTP, setShowOTP] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpBrowserInfo, setOtpBrowserInfo] = useState<any>(undefined);
  const [otpMessage, setOtpMessage] = useState("");

  // Track mouse movement for the background effect
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setMousePosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please enter your email and password");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiRequest("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));

      // Backend emails a Brevo confirmation code before the first sign-in
      if (response.ok && data.requiresOTP) {
        setOtpEmail(email);
        setOtpBrowserInfo(data.browserInfo);
        setOtpMessage(data.message || "");
        setShowOTP(true);
        return;
      }

      if (!response.ok) {
        throw new Error(data.msg || data.message || "Signup failed");
      }

      // Fallback (no OTP required): log in directly → organization setup
      auth.login(data.token, data.refreshToken, data.expiresIn);
    } catch (err: any) {
      setError(err.message || "Signup failed");
      toast({
        title: "Signup failed",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleOTPSuccess = (
    token: string,
    refreshToken: string,
    _user: any,
    expiresIn?: string
  ) => {
    // auth.login stores tokens and redirects to /organization/check → org setup
    auth.login(token, refreshToken, expiresIn);
  };

  // Email-confirmation step after signup
  if (showOTP) {
    return (
      <div className={`min-h-screen ${authShell} relative overflow-hidden flex items-center justify-center p-6`}>
        <div className={`absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse pointer-events-none ${orb1}`}></div>
        <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none ${orb2}`}></div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 w-full max-w-md"
        >
          <OTPVerification
            email={otpEmail}
            browserInfo={otpBrowserInfo}
            initialMessage={otpMessage}
            onSuccess={handleOTPSuccess}
            onCancel={() => setShowOTP(false)}
          />
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`h-screen ${authShell} relative overflow-hidden`}>
      {/* Animated Background Elements */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, ${mouseGlowColor}, transparent ${jet ? '42%' : '40%'})`
        }}
      />

      {/* Floating Orbs */}
      <div className={`absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse ${orb1}`}></div>
      <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl animate-pulse delay-1000 ${orb2}`}></div>
      <div className={`absolute top-3/4 left-1/3 w-64 h-64 rounded-full blur-3xl animate-pulse delay-2000 ${orb3}`}></div>

      {/* Grid Pattern Overlay */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}
      />

      <div className="relative z-10 flex h-screen">
        {/* Left Side - Brand & Features */}
        <div className="hidden lg:flex lg:w-1/2 flex-col justify-center p-6 lg:p-8 xl:p-12 2xl:p-16 relative">
          {/* Logo and Brand */}
          <div className="mb-6 lg:mb-8 xl:mb-12">
            {jet ? (
              <div className="flex items-center gap-3 mb-6">
                <div className="flex h-12 shrink-0 items-center">
                  <Image
                    src="/logoakwa.png"
                    alt="Government of Akwa Ibom State"
                    width={280}
                    height={80}
                    className="h-10 w-auto max-w-[220px] bg-transparent object-contain lg:h-12"
                  />
                </div>
                <div className="hidden sm:block border-l border-green-200 pl-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-green-950 leading-tight">
                    Office of the Head of Service
                  </p>
                  <p className="text-[10px] font-semibold text-green-800/75">
                    Government of Akwa Ibom State
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center mb-6">
                {brand.useImageLogo && brand.logo ? (
                  <div className="flex items-center">
                    <Image src={brand.logo} alt={brand.name} width={240} height={56} className="object-contain h-10 lg:h-12 xl:h-14 w-auto" />
                  </div>
                ) : (
                  <div className="relative">
                    <div className={`w-10 h-10 lg:w-12 lg:h-12 xl:w-14 xl:h-14 bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-2xl`}>
                      <span className="font-extrabold text-base lg:text-lg xl:text-xl tracking-tighter text-white">{brand.shortName}</span>
                    </div>
                    <div className={`absolute -top-1 -right-1 w-3 h-3 lg:w-4 lg:h-4 ${brand.colors.pulse} rounded-full border-2 border-slate-900 animate-pulse`}></div>
                  </div>
                )}
                {!(brand.useImageLogo && brand.logo) && (
                  <div className="ml-3 lg:ml-4">
                    <h1 className="text-xl lg:text-2xl xl:text-3xl font-bold text-white">{brand.loginHeading || brand.name}</h1>
                    <p className="text-xs lg:text-sm text-slate-300">{brand.loginSubheading || brand.tagline}</p>
                  </div>
                )}
              </div>
            )}

            <div className="max-w-md">
              <h2 className={`text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl font-bold mb-3 lg:mb-4 leading-tight ${textColor}`}>
                Join our
                <span className={`block bg-clip-text text-transparent bg-gradient-to-r ${accentGrad}`}>
                  smart platform
                </span>
              </h2>
              <p className={`text-sm lg:text-base xl:text-lg leading-relaxed ${textMuted}`}>
                Create your account and start transforming your hiring process today.
              </p>
            </div>
          </div>

          {/* Feature Cards */}
          <div className="space-y-2 lg:space-y-3 xl:space-y-4">
            {[
              {
                icon: <Zap className="w-5 h-5" />,
                title: "AI-Powered Matching",
                description: "Intelligent candidate-job matching with 95% accuracy"
              },
              {
                icon: <Shield className="w-5 h-5" />,
                title: "Secure Platform",
                description: "Enterprise-grade security for your recruitment data"
              },
              {
                icon: <Users className="w-5 h-5" />,
                title: "Team Collaboration",
                description: "Seamless workflow for hiring teams"
              }
            ].map((feature, index) => (
              <div
                key={index}
                className={`flex items-center p-2 lg:p-3 xl:p-4 backdrop-blur-sm rounded-lg lg:rounded-xl transition-all duration-300 group ${featureBg}`}
              >
                <div className={`flex-shrink-0 w-8 h-8 lg:w-9 lg:h-9 xl:w-10 xl:h-10 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform duration-300 ${iconGrad}`}>
                  {feature.icon}
                </div>
                <div className="ml-2 lg:ml-3 xl:ml-4">
                  <h3 className={`font-semibold text-sm lg:text-base ${textColor}`}>{feature.title}</h3>
                  <p className={`text-xs lg:text-sm ${textMuted}`}>{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Secondary Logo — hide for Jetstone */}
          {brand.secondaryLogo && !jet && (
            <div className="absolute bottom-8 left-8 xl:bottom-12 xl:left-12 flex items-center gap-3 opacity-80">
              <span className={`text-sm font-medium ${textMuted}`}>In partnership with</span>
              <Image src={brand.secondaryLogo} alt="Partner Logo" width={48} height={48} className="object-contain" />
            </div>
          )}
        </div>

        {/* Right Side - Signup Form */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-md">
            {/* Mobile Logo */}
            <div className="lg:hidden flex justify-center mb-8">
              {jet ? (
                <div className="flex flex-col items-center gap-2 text-center">
                  <Image
                    src="/logoakwa.png"
                    alt="Government of Akwa Ibom State"
                    width={220}
                    height={56}
                    className="h-10 w-auto max-w-[200px] bg-transparent object-contain"
                  />
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-green-950 leading-tight">
                      Office of the Head of Service
                    </p>
                    <p className="text-[9px] font-semibold text-green-800/75">
                      Government of Akwa Ibom State
                    </p>
                  </div>
                </div>
              ) : brand.useImageLogo && brand.logo ? (
                <div className="flex items-center">
                  <Image src={brand.logo} alt={brand.name} width={200} height={48} className="object-contain h-12 w-auto" />
                </div>
              ) : (
                <div className={`w-14 h-14 bg-gradient-to-br ${brand.gradient} rounded-xl flex items-center justify-center shadow-2xl`}>
                  <span className={`font-extrabold text-xl tracking-tighter ${textColor}`}>{brand.shortName}</span>
                </div>
              )}
            </div>

            {/* Floating Particles */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  className={`absolute w-1 h-1 rounded-full ${particleColor}`}
                  initial={{
                    x: Math.random() * 400,
                    y: Math.random() * 600,
                    scale: 0
                  }}
                  animate={{
                    y: [Math.random() * 600, Math.random() * 600 - 100],
                    scale: [0, 1, 0],
                    opacity: [0, 1, 0]
                  }}
                  transition={{
                    duration: 3 + Math.random() * 2,
                    repeat: Infinity,
                    delay: Math.random() * 2
                  }}
                />
              ))}
            </div>

            {/* Enhanced Signup Card */}
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
            >
              <Card className={`backdrop-blur-2xl overflow-hidden relative ${cardBg}`}>
                {/* Subtle Animated Border */}
                <div className={`absolute inset-0 rounded-lg animate-pulse opacity-30 ${jet ? 'bg-gradient-to-r from-green-500/12 via-amber-500/12 to-yellow-500/10' : 'bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10'}`}></div>

                <CardHeader className="space-y-1 text-center pb-6 relative z-10">
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                  >
                    <CardTitle className={`text-2xl font-bold flex items-center justify-center gap-2 ${textColor}`}>
                      Create Account
                      <motion.div
                        animate={{ rotate: [0, 10, 0] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        <Sparkles className="w-5 h-5 text-yellow-400" />
                      </motion.div>
                    </CardTitle>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                  >
                    <CardDescription className={`text-base ${textMuted}`}>
                      Sign up for your {brand.name} account
                    </CardDescription>
                  </motion.div>
                </CardHeader>

                <div className="relative z-10">
                  <form onSubmit={handleSignup}>
                    <CardContent className="space-y-4 px-6">
                      {error && (
                        <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                          {error}
                        </div>
                      )}

                      <div className="space-y-2">
                        <Label htmlFor="email" className={textColor}>Email</Label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input
                            id="email"
                            type="email"
                            autoComplete="email"
                            placeholder="you@company.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="password" className={textColor}>Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input
                            id="password"
                            type="password"
                            autoComplete="new-password"
                            placeholder="At least 8 characters"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="confirmPassword" className={textColor}>Confirm Password</Label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                          <Input
                            id="confirmPassword"
                            type="password"
                            autoComplete="new-password"
                            placeholder="Re-enter your password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400"
                            required
                          />
                        </div>
                      </div>
                    </CardContent>

                    <CardFooter className="flex flex-col px-6 pt-1 pb-6">
                      <motion.div
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 400 }}
                        className="w-full"
                      >
                        <Button
                          type="submit"
                          className={`w-full text-white py-6 rounded-lg font-medium text-base flex items-center justify-center gap-2 transition-all duration-300 border-0 shadow-lg hover:shadow-xl ${btnGrad}`}
                          disabled={isLoading}
                        >
                          <span>{isLoading ? "Creating account..." : "Create account"}</span>
                          {!isLoading && <ArrowRight className="h-4 w-4" />}
                        </Button>
                      </motion.div>

                      <p className={`mt-6 text-center text-sm ${textMuted}`}>
                        Already have an account?{" "}
                        <Link
                          href="/login"
                          className={`font-medium transition-colors ${jet ? 'text-green-700 hover:text-green-600' : 'text-blue-400 hover:text-blue-300'}`}
                        >
                          Sign In
                        </Link>
                      </p>
                    </CardFooter>
                  </form>
                </div>
              </Card>
            </motion.div>

            {/* Mobile Secondary Logo — hide for Jetstone */}
            {brand.secondaryLogo && !jet && (
              <motion.div
                className="lg:hidden mt-10 flex flex-col items-center justify-center gap-2 opacity-80"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.0, duration: 0.5 }}
              >
                <span className="text-slate-400 text-xs font-medium">In partnership with</span>
                <Image src={brand.secondaryLogo} alt="Partner Logo" width={40} height={40} className="object-contain" />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
