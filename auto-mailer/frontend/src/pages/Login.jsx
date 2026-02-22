import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { validateEmail } from '../utils/auth';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Alert from '../components/ui/Alert';

const Login = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated, isLoading, error, clearError } = useAuth();
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, isLoading, navigate]);

  // Clear errors when form data changes
  useEffect(() => {
    setFormErrors({});
    if (error) {
      clearError();
    }
  }, [formData.email, formData.password]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const validateForm = () => {
    const errors = {};
    
    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    
    // Password validation
    if (!formData.password) {
      errors.password = 'Password is required';
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const result = await login({
        email: formData.email.trim(),
        password: formData.password,
      });
      
      if (result.success) {
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('Login error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary-600 to-primary-800 p-12 items-center justify-center">
        <div className="max-w-md text-white">
          <div className="flex items-center mb-8">
            <div className="bg-white bg-opacity-20 rounded-xl p-3 mr-4">
              <Sparkles className="h-8 w-8" />
            </div>
            <h1 className="text-3xl font-bold">Auto Mailer</h1>
          </div>
          <h2 className="text-2xl font-semibold mb-6">
            Welcome back to the future of email automation
          </h2>
          <p className="text-lg text-blue-100 leading-relaxed">
            Streamline your email workflows with intelligent automation. 
            Connect, create, and send personalized emails at scale.
          </p>
          <div className="mt-8 space-y-4">
            <div className="flex items-center">
              <div className="bg-white bg-opacity-20 rounded-lg p-2 mr-3">
                <Mail className="h-5 w-5" />
              </div>
              <span>Smart email templates</span>
            </div>
            <div className="flex items-center">
              <div className="bg-white bg-opacity-20 rounded-lg p-2 mr-3">
                <ArrowRight className="h-5 w-5" />
              </div>
              <span>Automated workflows</span>
            </div>
            <div className="flex items-center">
              <div className="bg-white bg-opacity-20 rounded-lg p-2 mr-3">
                <Sparkles className="h-5 w-5" />
              </div>
              <span>AI-powered personalization</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="max-w-md w-full">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center">
              <div className="bg-primary-100 rounded-xl p-3 mr-3">
                <Sparkles className="h-8 w-8 text-primary-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Auto Mailer</h1>
            </div>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Sign in to your account
            </h2>
            <p className="text-gray-600">
              Don't have an account?{' '}
              <Link 
                to="/signup" 
                className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                Sign up here
              </Link>
            </p>
          </div>

          {error && (
            <Alert
              type="error"
              message={error}
              className="mb-6"
              closable
              onClose={clearError}
            />
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative">
              <Input
                label="Email address"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Enter your email"
                error={formErrors.email}
                required
                disabled={isSubmitting}
              />
              <Mail className="absolute right-3 top-9 h-5 w-5 text-gray-400" />
            </div>

            <div className="relative">
              <Input
                label="Password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Enter your password"
                error={formErrors.password}
                required
                disabled={isSubmitting}
              />
              <Lock className="absolute right-3 top-9 h-5 w-5 text-gray-400" />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700">
                  Remember me
                </label>
              </div>

              <div className="text-sm">
                <a
                  href="#"
                  className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
                >
                  Forgot your password?
                </a>
              </div>
            </div>

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={isSubmitting}
              fullWidth
              size="lg"
              className="group"
            >
              <span>Sign in</span>
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <p className="text-center text-sm text-gray-600">
              By signing in, you agree to our{' '}
              <a href="#" className="text-primary-600 hover:text-primary-700 transition-colors">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="#" className="text-primary-600 hover:text-primary-700 transition-colors">
                Privacy Policy
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
