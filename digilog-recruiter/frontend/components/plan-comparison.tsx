"use client"

import { useState } from "react"
import { Check, HelpCircle, Zap } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { AnimatedGradientBorder } from "@/components/animated-gradient-border"

// Plan data
const plans = {
  monthly: [
    {
      id: "basic",
      name: "Basic",
      description: "Essential tools for small teams",
      price: 29,
      features: [
        "Up to 10 job postings",
        "Basic candidate matching",
        "Standard analytics",
        "2 team members",
        "Email support",
      ],
      limitations: ["No AI-powered insights", "Limited candidate database", "Basic reporting only"],
    },
    {
      id: "professional",
      name: "Professional",
      description: "Advanced features for growing teams",
      price: 49,
      popular: true,
      features: [
        "Up to 25 job postings",
        "AI candidate matching",
        "Advanced analytics",
        "5 team members",
        "Priority email support",
        "Custom job templates",
        "Candidate tracking system",
      ],
      limitations: ["Limited API access", "Standard integrations only"],
    },
    {
      id: "enterprise",
      name: "Enterprise",
      description: "Complete solution for large organizations",
      price: 99,
      features: [
        "Unlimited job postings",
        "Advanced AI matching & insights",
        "Custom analytics dashboard",
        "Unlimited team members",
        "Dedicated account manager",
        "API access",
        "Custom integrations",
        "White-labeling options",
        "Advanced security features",
      ],
      limitations: [],
    },
  ],
  annual: [
    {
      id: "basic",
      name: "Basic",
      description: "Essential tools for small teams",
      price: 24,
      features: [
        "Up to 10 job postings",
        "Basic candidate matching",
        "Standard analytics",
        "2 team members",
        "Email support",
      ],
      limitations: ["No AI-powered insights", "Limited candidate database", "Basic reporting only"],
    },
    {
      id: "professional",
      name: "Professional",
      description: "Advanced features for growing teams",
      price: 39,
      popular: true,
      features: [
        "Up to 25 job postings",
        "AI candidate matching",
        "Advanced analytics",
        "5 team members",
        "Priority email support",
        "Custom job templates",
        "Candidate tracking system",
      ],
      limitations: ["Limited API access", "Standard integrations only"],
    },
    {
      id: "enterprise",
      name: "Enterprise",
      description: "Complete solution for large organizations",
      price: 79,
      features: [
        "Unlimited job postings",
        "Advanced AI matching & insights",
        "Custom analytics dashboard",
        "Unlimited team members",
        "Dedicated account manager",
        "API access",
        "Custom integrations",
        "White-labeling options",
        "Advanced security features",
      ],
      limitations: [],
    },
  ],
}

interface PlanComparisonProps {
  currentPlan: string
  onSelectPlan: (planId: string) => void
}

export function PlanComparison({ currentPlan, onSelectPlan }: PlanComparisonProps) {
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly")
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<any>(null)

  const handleUpgradeClick = (plan: any) => {
    setSelectedPlan(plan)
    setUpgradeDialogOpen(true)
  }

  const handleConfirmUpgrade = () => {
    if (selectedPlan) {
      onSelectPlan(selectedPlan.id)
    }
    setUpgradeDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <Tabs
          value={billingCycle}
          onValueChange={(value) => setBillingCycle(value as "monthly" | "annual")}
          className="w-[400px]"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="annual">
              Annual
              <Badge variant="outline" className="ml-2 bg-green-50 text-green-700 border-green-200">
                Save 20%
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {plans[billingCycle].map((plan) => (
          <Card key={plan.id} className={`relative overflow-hidden ${plan.popular ? "border-primary/50" : ""}`}>
            {plan.popular && (
              <>
                <AnimatedGradientBorder />
                <div className="absolute top-0 right-0">
                  <div className="bg-primary text-primary-foreground text-xs font-medium px-3 py-1 rounded-bl-lg">
                    Most Popular
                  </div>
                </div>
              </>
            )}
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
              <CardDescription>{plan.description}</CardDescription>
              <div className="mt-2">
                <span className="text-3xl font-bold">${plan.price}</span>
                <span className="text-muted-foreground">
                  /{billingCycle === "monthly" ? "month" : "month, billed annually"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center">
                  <Check className="h-4 w-4 mr-1 text-green-500" />
                  Included features
                </h4>
                <ul className="space-y-2 text-sm">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start">
                      <Check className="mr-2 h-4 w-4 text-green-500 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {plan.limitations.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2 flex items-center text-muted-foreground">
                    Limitations
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 ml-1 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="w-[200px] text-xs">
                            These features are not available in this plan but are included in higher tiers.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </h4>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {plan.limitations.map((limitation, i) => (
                      <li key={i} className="flex items-start">
                        <span className="mr-2 h-4 w-4 flex items-center justify-center">-</span>
                        <span>{limitation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
            <CardFooter>
              {plan.id === currentPlan ? (
                <Button variant="outline" className="w-full" disabled>
                  Current Plan
                </Button>
              ) : (
                <Dialog open={upgradeDialogOpen && selectedPlan?.id === plan.id} onOpenChange={setUpgradeDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      className="w-full"
                      variant={plan.popular ? "default" : "outline"}
                      onClick={() => handleUpgradeClick(plan)}
                    >
                      {plan.id === "enterprise" ? "Contact Sales" : "Upgrade"}
                      {plan.popular && <Zap className="ml-2 h-4 w-4" />}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Upgrade to {selectedPlan?.name}</DialogTitle>
                      <DialogDescription>
                        You are about to upgrade from Professional to {selectedPlan?.name}. Your billing will be
                        adjusted accordingly.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <p className="font-medium">Billing changes:</p>
                        <div className="rounded-md bg-muted p-4">
                          <div className="flex justify-between">
                            <span>New price:</span>
                            <span className="font-medium">
                              ${selectedPlan?.price}/{billingCycle === "monthly" ? "month" : "month, billed annually"}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm text-muted-foreground mt-1">
                            <span>Current price:</span>
                            <span>
                              ${plans[billingCycle].find((p) => p.id === currentPlan)?.price}/
                              {billingCycle === "monthly" ? "month" : "month, billed annually"}
                            </span>
                          </div>
                          <div className="border-t mt-2 pt-2 flex justify-between font-medium">
                            <span>Difference:</span>
                            <span className="text-primary">
                              +$
                              {(
                                selectedPlan?.price -
                                (plans[billingCycle].find((p) => p.id === currentPlan)?.price || 0)
                              ).toFixed(2)}
                              /{billingCycle === "monthly" ? "month" : "month, billed annually"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <p className="font-medium mb-2">New features you'll get:</p>
                        <ul className="space-y-1">
                          {selectedPlan?.features
                            .filter((f) => !plans[billingCycle].find((p) => p.id === currentPlan)?.features.includes(f))
                            .map((feature, i) => (
                              <li key={i} className="flex items-start text-sm">
                                <Check className="mr-2 h-4 w-4 text-green-500 mt-0.5" />
                                <span>{feature}</span>
                              </li>
                            ))}
                        </ul>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setUpgradeDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleConfirmUpgrade}>Confirm Upgrade</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardFooter>
          </Card>
        ))}
      </div>

      <div className="text-center text-sm text-muted-foreground mt-8">
        <p>
          Need a custom plan?{" "}
          <a href="#" className="text-primary hover:underline">
            Contact our sales team
          </a>
        </p>
      </div>
    </div>
  )
}
