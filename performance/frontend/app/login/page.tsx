'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box, Typography, Button, Card, CardContent, CircularProgress
} from '@mui/material';
import {
  Assessment, TrendingUp, EmojiEvents, Shield, ArrowForward, Apps
} from '@mui/icons-material';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  
  const { isAuthenticated, isLoading, login } = useAuth();

  const error = searchParams.get('error');

  // Mouse tracking for interactive background
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  const handleLogin = () => {
    setIsProcessing(true);
    login();
  };

  if (isLoading || isProcessing) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #0f172a 0%, #581c87 50%, #0f172a 100%)',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* Animated background */}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            pointerEvents: 'none'
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: '25%',
            left: '25%',
            width: '384px',
            height: '384px',
            bgcolor: 'rgba(59, 130, 246, 0.2)',
            borderRadius: '50%',
            filter: 'blur(96px)',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            bottom: '25%',
            right: '25%',
            width: '384px',
            height: '384px',
            bgcolor: 'rgba(168, 85, 247, 0.2)',
            borderRadius: '50%',
            filter: 'blur(96px)',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            animationDelay: '1s'
          }}
        />

        <Box sx={{ position: 'relative', zIndex: 10, textAlign: 'center' }}>
          <Card
            sx={{
              bgcolor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(40px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: 4,
              p: 6,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}
          >
            <Box sx={{ position: 'relative', mb: 3 }}>
              <CircularProgress
                size={96}
                thickness={3}
                sx={{
                  color: 'rgba(147, 197, 253, 0.5)',
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  ml: '-48px'
                }}
              />
              <CircularProgress
                size={96}
                thickness={3}
                sx={{ color: '#3b82f6' }}
              />
            </Box>

            <Typography variant="h5" fontWeight="bold" color="white" mb={1.5}>
              {isProcessing ? 'Redirecting to Login' : 'Completing Sign In'}
            </Typography>

            <Typography variant="body2" color="rgba(226, 232, 240, 0.8)">
              {isProcessing
                ? 'Connecting to Identity Provider...'
                : 'Securely logging you into Performance Management...'}
            </Typography>

            <Box
              sx={{
                mt: 3,
                height: 4,
                bgcolor: 'rgba(59, 130, 246, 0.3)',
                borderRadius: 1,
                overflow: 'hidden'
              }}
            >
              <Box
                sx={{
                  height: '100%',
                  background: 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)',
                  borderRadius: 1,
                  animation: 'loading 1.5s ease-in-out infinite'
                }}
              />
            </Box>
          </Card>
        </Box>

        <style jsx global>{`
          @keyframes loading {
            0%, 100% { transform: translateX(-100%); }
            50% { transform: translateX(100%); }
          }
        `}</style>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #581c87 50%, #0f172a 100%)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Animated Background Elements */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          opacity: 0.3,
          background: `radial-gradient(600px circle at ${mousePosition.x}px ${mousePosition.y}px, rgba(59, 130, 246, 0.15), transparent 40%)`
        }}
      />

      {/* Floating Orbs */}
      <Box
        sx={{
          position: 'absolute',
          top: '25%',
          left: '25%',
          width: '384px',
          height: '384px',
          bgcolor: 'rgba(59, 130, 246, 0.2)',
          borderRadius: '50%',
          filter: 'blur(96px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          bottom: '25%',
          right: '25%',
          width: '384px',
          height: '384px',
          bgcolor: 'rgba(168, 85, 247, 0.2)',
          borderRadius: '50%',
          filter: 'blur(96px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          animationDelay: '1s'
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: '75%',
          left: '33%',
          width: '256px',
          height: '256px',
          bgcolor: 'rgba(236, 72, 153, 0.2)',
          borderRadius: '50%',
          filter: 'blur(96px)',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          animationDelay: '2s'
        }}
      />

      {/* Grid Pattern */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          opacity: 0.1,
          backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)',
          backgroundSize: '50px 50px'
        }}
      />

      <Box
        sx={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          minHeight: '100vh'
        }}
      >
        {/* Left Side - Brand & Features */}
        <Box
          sx={{
            display: { xs: 'none', lg: 'flex' },
            width: { lg: '50%' },
            flexDirection: 'column',
            justifyContent: 'center',
            p: { lg: 4, xl: 6, '2xl': 8 }
          }}
        >
          {/* Logo and Brand */}
          <Box mb={{ lg: 4, xl: 6 }}>
            <Box display="flex" alignItems="center" mb={3}>
              <Box position="relative">
                <Box
                  sx={{
                    width: { lg: 48, xl: 56 },
                    height: { lg: 48, xl: 56 },
                    background: 'linear-gradient(135deg, #60a5fa 0%, #a855f7 100%)',
                    borderRadius: 3,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                  }}
                >
                  <Assessment sx={{ fontSize: { lg: 28, xl: 32 }, color: 'white' }} />
                </Box>
                <Box
                  sx={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    width: { lg: 12, xl: 16 },
                    height: { lg: 12, xl: 16 },
                    bgcolor: '#4ade80',
                    borderRadius: '50%',
                    border: '2px solid #0f172a',
                    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                  }}
                />
              </Box>
              <Box ml={2}>
                <Typography variant="h4" fontWeight="bold" color="white">
                  Performance Management
                </Typography>
                <Typography variant="body2" color="rgb(203, 213, 225)">
                  AI-Powered Performance Reviews
                </Typography>
              </Box>
            </Box>

            <Box maxWidth="md">
              <Typography
                variant="h3"
                fontWeight="bold"
                color="white"
                mb={2}
                sx={{ lineHeight: 1.2 }}
              >
                Drive performance
                <Box
                  component="span"
                  display="block"
                  sx={{
                    background: 'linear-gradient(90deg, #60a5fa 0%, #a855f7 50%, #ec4899 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                  }}
                >
                  with AI insights
                </Box>
              </Typography>
              <Typography variant="body1" color="rgb(203, 213, 225)" sx={{ lineHeight: 1.75 }}>
                Streamline reviews, track OKRs, and empower your team with intelligent performance management.
              </Typography>
            </Box>
          </Box>

          {/* Feature Cards */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              {
                icon: <Assessment sx={{ fontSize: 20 }} />,
                title: "AI-Powered Reviews",
                description: "Automated review generation and bias detection"
              },
              {
                icon: <TrendingUp sx={{ fontSize: 20 }} />,
                title: "OKR Tracking",
                description: "Goal alignment from organization to individual"
              },
              {
                icon: <EmojiEvents sx={{ fontSize: 20 }} />,
                title: "Continuous Feedback",
                description: "Real-time recognition and 360° feedback"
              }
            ].map((feature, index) => (
              <Card
                key={index}
                sx={{
                  bgcolor: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  transition: 'all 0.3s',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.1)',
                    transform: 'translateX(4px)'
                  }
                }}
              >
                <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      background: 'linear-gradient(135deg, #60a5fa 0%, #a855f7 100%)',
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      flexShrink: 0,
                      transition: 'transform 0.3s',
                      '&:hover': { transform: 'scale(1.1)' }
                    }}
                  >
                    {feature.icon}
                  </Box>
                  <Box>
                    <Typography variant="body1" fontWeight="600" color="white">
                      {feature.title}
                    </Typography>
                    <Typography variant="caption" color="rgb(203, 213, 225)">
                      {feature.description}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
        </Box>

        {/* Right Side - Login Form */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            p: { xs: 3, lg: 6 }
          }}
        >
          <Box sx={{ width: '100%', maxWidth: 'md' }}>
            {/* Mobile Logo */}
            <Box
              sx={{
                display: { xs: 'flex', lg: 'none' },
                justifyContent: 'center',
                mb: 4
              }}
            >
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  background: 'linear-gradient(135deg, #60a5fa 0%, #a855f7 100%)',
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                }}
              >
                <Assessment sx={{ fontSize: 32, color: 'white' }} />
              </Box>
            </Box>

            {/* Login Card */}
            <Card
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(40px)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Animated Border */}
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, rgba(168, 85, 247, 0.1) 50%, rgba(236, 72, 153, 0.1) 100%)',
                  borderRadius: 2,
                  animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                  opacity: 0.3
                }}
              />

              <CardContent sx={{ position: 'relative', zIndex: 10, p: 4 }}>
                {/* Header */}
                <Box textAlign="center" mb={3}>
                  <Typography variant="h4" fontWeight="bold" color="white" mb={1}>
                    Welcome back
                  </Typography>
                  <Typography variant="body1" color="rgb(203, 213, 225)">
                    Sign in to your Performance Management account
                  </Typography>
                </Box>

                {/* Error */}
                {error && (
                  <Card
                    sx={{
                      bgcolor: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      mb: 3
                    }}
                  >
                    <CardContent sx={{ p: 2 }}>
                      <Typography variant="body2" color="rgb(254, 202, 202)">
                        {decodeURIComponent(error)}
                      </Typography>
                    </CardContent>
                  </Card>
                )}

                {/* Description */}
                <Box textAlign="center" mb={4}>
                  <Typography variant="body2" color="rgb(203, 213, 225)">
                    Sign in securely using your Identity Provider account
                  </Typography>
                </Box>

                {/* Login Button */}
                <Button
                  fullWidth
                  size="large"
                  onClick={handleLogin}
                  sx={{
                    background: 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)',
                    color: 'white',
                    fontWeight: 600,
                    height: 48,
                    borderRadius: 3,
                    transition: 'all 0.3s',
                    boxShadow: '0 10px 25px -5px rgba(59, 130, 246, 0.5)',
                    '&:hover': {
                      background: 'linear-gradient(90deg, #2563eb 0%, #7c3aed 100%)',
                      boxShadow: '0 20px 40px -10px rgba(59, 130, 246, 0.6)',
                      transform: 'translateY(-2px)'
                    }
                  }}
                >
                  <Box display="flex" alignItems="center" gap={1.5}>
                    <span>Login with Identity Provider</span>
                    <ArrowForward />
                  </Box>
                </Button>
              </CardContent>
            </Card>

            {/* App Hub Link */}
            <Card
              component="a"
              href={process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000'}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                mt: 3,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                p: 2,
                bgcolor: 'rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                textDecoration: 'none',
                transition: 'all 0.3s',
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.15)',
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  transform: 'translateY(-2px)'
                }
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 3,
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3) 0%, rgba(168, 85, 247, 0.3) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.15)'
                }}
              >
                <Apps sx={{ fontSize: 20, color: 'white' }} />
              </Box>
              <Box flex={1}>
                <Typography variant="body2" fontWeight="600" color="white">
                  Open App Hub
                </Typography>
                <Typography variant="caption" color="rgb(203, 213, 225)">
                  View all SmartHR apps and tools
                </Typography>
              </Box>
              <ArrowForward sx={{ fontSize: 16, color: 'rgb(203, 213, 225)' }} />
            </Card>

            {/* Security Notice */}
            <Box
              sx={{
                mt: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                color: 'rgb(148, 163, 184)'
              }}
            >
              <Shield sx={{ fontSize: 16, animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
              <Typography variant="caption" textAlign="center">
                Your data is protected with enterprise-grade security
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}




