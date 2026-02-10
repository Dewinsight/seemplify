'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, Star, Sparkles, ArrowRight } from 'lucide-react';
import { getPublishedPlans, Plan } from '@/services/planService';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export default function PricingSection() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchPlans = async () => {
      setIsLoading(true);
      try {
        const response = await getPublishedPlans();
        if (response.success && response.plans) {
          const sortedPlans = [...response.plans].sort((a, b) => a.displayOrder - b.displayOrder);
          setPlans(sortedPlans);
        } else {
          setError(response.message || 'Failed to load pricing plans');
        }
      } catch (err) {
        console.error('Error fetching plans:', err);
        setError('An error occurred while loading pricing information');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPlans();
  }, []);

  const formatCurrency = (price: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const getBillingCycleText = (cycle: string) => {
    switch (cycle) {
      case 'monthly':
        return '/month';
      case 'quarterly':
        return '/quarter';
      case 'annual':
      case 'yearly':
        return '/year';
      default:
        return '';
    }
  };

  const formatLimit = (limit: number | string): string => {
    if (limit === 'unlimited' || limit === Infinity) {
      return 'Unlimited';
    }
    return typeof limit === 'number' ? limit.toLocaleString() : String(limit);
  };

  return (
    <section className="relative z-10 container mx-auto px-4 py-20 overflow-hidden">
      {/* Simplified background decoration */}
      <div className="absolute top-1/3 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 left-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Header */}
      <motion.div
        className="text-center mb-16"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <motion.span
          className="inline-flex items-center px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm font-semibold mb-4"
          whileHover={{ scale: 1.05 }}
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Simple, Transparent Pricing
        </motion.span>
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-black mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-100 to-purple-100">
          Choose The Perfect Plan
        </h2>
        <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto">
          Start with a free trial. Scale as you grow. No hidden fees.
        </p>
      </motion.div>

      {isLoading ? (
        <div className="flex justify-center items-center h-96">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
            <div className="absolute inset-0 border-t-4 border-blue-500 rounded-full animate-spin"></div>
          </div>
        </div>
      ) : error ? (
        <motion.div
          className="text-center p-10 bg-red-500/10 rounded-2xl border border-red-500/20 backdrop-blur-xl max-w-md mx-auto"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <p className="text-red-400 text-lg font-semibold mb-2">{error}</p>
          <p className="text-slate-400">Please try again later.</p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
          {plans.map((plan, idx) => {
            const isPopular = plan.isDefault;
            const includedFeatures = plan.features.filter(f => f.included).slice(0, 5);

            return (
              <motion.div
                key={plan._id || idx}
                className={`relative ${isPopular ? 'md:scale-105' : ''}`}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.5,
                  delay: idx * 0.1,
                }}
                whileHover={{ y: -4 }}
              >
                {/* Card */}
                <div className={`relative rounded-2xl p-8 h-full flex flex-col ${
                  isPopular
                    ? 'bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600 shadow-2xl shadow-purple-500/50'
                    : 'bg-slate-900/80 border border-slate-800'
                } backdrop-blur-xl`}>

                  {/* Popular Badge */}
                  {isPopular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-yellow-400 to-orange-500 text-slate-900 px-4 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-lg">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      MOST POPULAR
                    </div>
                  )}

                  {/* Plan Name */}
                  <div className="mb-6">
                    <h3 className={`text-2xl font-bold ${isPopular ? 'text-white' : 'text-white'}`}>
                      {plan.name}
                    </h3>
                  </div>

                  {/* Price - HERO ELEMENT */}
                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className={`text-6xl font-black ${isPopular ? 'text-white' : 'text-white'}`}>
                        {formatCurrency(plan.price, plan.currency).replace('.00', '')}
                      </span>
                      <span className={`text-xl ${isPopular ? 'text-white/80' : 'text-slate-400'}`}>
                        {getBillingCycleText(plan.billingCycle)}
                      </span>
                    </div>

                    {/* One-line limits summary */}
                    <p className={`mt-3 text-sm ${isPopular ? 'text-white/70' : 'text-slate-400'}`}>
                      {formatLimit(plan.limits.memberLimit)} team members • {formatLimit(plan.limits.storageLimit)} storage
                    </p>
                  </div>

                  {/* Features - Top 5 only */}
                  <div className="mb-8 flex-1">
                    <ul className="space-y-3">
                      {includedFeatures.map((feature, fidx) => (
                        <motion.li
                          key={fidx}
                          className="flex items-start gap-3"
                          initial={{ opacity: 0, x: -10 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.3 + (fidx * 0.05) }}
                        >
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            isPopular ? 'bg-white/20' : 'bg-blue-500/20'
                          }`}>
                            <Check className={`w-3 h-3 stroke-[3] ${isPopular ? 'text-white' : 'text-blue-400'}`} />
                          </div>
                          <span className={`text-sm ${isPopular ? 'text-white/90' : 'text-slate-300'}`}>
                            {feature.name}
                          </span>
                        </motion.li>
                      ))}
                    </ul>

                    {plan.features.filter(f => f.included).length > 5 && (
                      <p className={`text-sm mt-4 ${isPopular ? 'text-white/60' : 'text-slate-500'}`}>
                        + {plan.features.filter(f => f.included).length - 5} more features
                      </p>
                    )}
                  </div>

                  {/* CTA Button */}
                  <Button
                    className={`w-full py-6 text-base font-bold group ${
                      isPopular
                        ? 'bg-white text-purple-600 hover:bg-white/90 shadow-xl'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    } transition-all duration-200`}
                    onClick={() => router.push('/login?plan=' + plan.code)}
                  >
                    <span className="flex items-center justify-center gap-2">
                      {plan.trialDays > 0 ? `Start ${plan.trialDays}-Day Free Trial` : 'Get Started'}
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <motion.div
        className="mt-16 text-center"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ delay: 0.5 }}
      >
        <p className="text-slate-400 text-sm mb-3">
          ✨ All plans include secure storage, regular updates, and customer support
        </p>
        <p className="text-slate-500 text-sm">
          Need a custom enterprise plan?{' '}
          <button
            className="text-blue-400 hover:text-blue-300 underline font-medium transition-colors"
            onClick={() => router.push('/contact')}
          >
            Contact sales →
          </button>
        </p>
      </motion.div>
    </section>
  );
}
