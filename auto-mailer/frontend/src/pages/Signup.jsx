import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Mail, Lock, ArrowRight, Sparkles, Shield, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { validateEmail, validatePassword } from '../utils/auth';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Alert from '../components/ui/Alert';

const Signup = () => {
  const navigate = useNavigate();
  const { register, isAuthenticated, isLoading, error, clearError } = useAuth();
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  
  const [formErrors, setFormErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

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
  }, [formData.email, formData.password, formData.name, formData.confirmPassword]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const validateForm = () => {
    const errors = {};
    
    // Name validation
    if (!formData.name.trim()) {
      errors.name = 'Name is required';
    } else if (formData.name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters long';
    }
    
    // Email validation
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    
    // Password validation
    const passwordValidation = validatePassword(formData.password);
    if (!passwordValidation.isValid) {
      errors.password = passwordValidation.errors[0];
    }
    
    // Confirm password validation
    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }
    
    // Terms acceptance
    if (!acceptedTerms) {
      errors.terms = 'You must accept the Terms of Service and Privacy Policy';
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
      const result = await register({
        name: formData.name.trim(),
        email: formData.email.trim(),
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });
      
      if (result.success) {
        navigate('/dashboard');
      }
    } catch (err) {
      console.error('Registration error:', err);
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
            Join thousands of users automating their email workflows
          </h2>
          <p className="text-lg text-blue-100 leading-relaxed mb-8">
            Get started with our powerful email automation platform. 
            Create, schedule, and manage your email campaigns with ease.
          </p>
          <div className="space-y-4">
            <div className="flex items-center">
              <CheckCircle className="h-5 w-5 mr-3 text-green-300" />
              <span>Free to get started</span>
            </div>
            <div className="flex items-center">
              <CheckCircle className="h-5 w-5 mr-3 text-green-300" />
              <span>Advanced email templates</span>
            </div>
            <div className="flex items-center">
              <CheckCircle className="h-5 w-5 mr-3 text-green-300" />
              <span>Analytics and insights</span>
            </div>
            <div className="flex items-center">
              <Shield className="h-5 w-5 mr-3 text-green-300" />
              <span>Enterprise-grade security</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Signup Form */}
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
              Create your account
            </h2>
            <p className="text-gray-600">
              Already have an account?{' '}
              <Link 
                to="/login" 
                className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                Sign in here
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
                label="Full name"
                name="name"
                type="text"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Enter your full name"
                error={formErrors.name}
                required
                disabled={isSubmitting}
              />
              <User className="absolute right-3 top-9 h-5 w-5 text-gray-400" />
            </div>

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
                placeholder="Create a password"
                error={formErrors.password}
                required
                disabled={isSubmitting}
              />
              <Lock className="absolute right-3 top-9 h-5 w-5 text-gray-400" />
            </div>

            <div className="relative">
              <Input
                label="Confirm password"
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                placeholder="Confirm your password"
                error={formErrors.confirmPassword}
                required
                disabled={isSubmitting}
              />
              <Lock className="absolute right-3 top-9 h-5 w-5 text-gray-400" />
            </div>

            <div className="space-y-4">
              <div className="flex items-start">
                <input
                  id="accept-terms"
                  name="accept-terms"
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded mt-0.5"
                  disabled={isSubmitting}
                />
                <label htmlFor="accept-terms" className="ml-3 block text-sm text-gray-700">
                  I agree to the{' '}
                  <a href="#" className="text-primary-600 hover:text-primary-700 transition-colors">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="#" className="text-primary-600 hover:text-primary-700 transition-colors">
                    Privacy Policy
                  </a>
                </label>
              </div>
              
              {formErrors.terms && (
                <p className="text-sm text-red-600">
                  {formErrors.terms}
                </p>
              )}
            </div>

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={isSubmitting}
              fullWidth
              size="lg"
              className="group"
            >
              <span>Create account</span>
              <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-center space-x-4 text-sm text-gray-500">
              <div className="flex items-center">
                <Shield className="h-4 w-4 mr-1" />
                <span>Secure signup</span>
              </div>
              <div className="w-px h-4 bg-gray-300"></div>
              <div className="flex items-center">
                <CheckCircle className="h-4 w-4 mr-1" />
                <span>No spam, ever</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Signup;
