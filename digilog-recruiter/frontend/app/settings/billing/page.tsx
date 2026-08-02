"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Check, FileText, Lock, Shield } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InvoiceList } from "@/components/invoice-list"
import { PlanComparison } from "@/components/plan-comparison"
import { PaymentMethodSelector } from "@/components/payment-method-selector"
import { AnimatedGradientBorder } from "@/components/animated-gradient-border"

export default function BillingPage() {
  const [currentPlan, setCurrentPlan] = useState("professional")

  return (
    <div className="container mx-auto py-8 space-y-8 max-w-7xl">
      <div className="flex flex-col space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Billing & Subscription</h1>
        <p className="text-muted-foreground">Manage your subscription plan, payment methods, and billing history</p>
      </div>

      <Tabs defaultValue="subscription" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="subscription" className="space-y-8 pt-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="relative overflow-hidden">
              <AnimatedGradientBorder />
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Current Plan</span>
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    Active
                  </span>
                </CardTitle>
                <CardDescription>Your current subscription details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-2xl font-bold">Professional</div>
                  <div className="text-3xl font-bold">
                    $49<span className="text-sm font-normal text-muted-foreground">/month</span>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  Your plan renews on <span className="font-medium">June 15, 2025</span>
                </div>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center">
                    <Check className="mr-2 h-4 w-4 text-primary" />
                    <span>Up to 25 job postings</span>
                  </li>
                  <li className="flex items-center">
                    <Check className="mr-2 h-4 w-4 text-primary" />
                    <span>AI candidate matching</span>
                  </li>
                  <li className="flex items-center">
                    <Check className="mr-2 h-4 w-4 text-primary" />
                    <span>Advanced analytics</span>
                  </li>
                  <li className="flex items-center">
                    <Check className="mr-2 h-4 w-4 text-primary" />
                    <span>5 team members</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter>
                <Button variant="outline" className="w-full" asChild>
                  <Link href="#plan-comparison">
                    Compare Plans <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Payment Method</CardTitle>
                <CardDescription>Manage your payment methods</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <PaymentMethodSelector />
              </CardContent>
            </Card>
          </div>

          <div id="plan-comparison">
            <h2 className="text-2xl font-bold mb-6">Available Plans</h2>
            <PlanComparison currentPlan={currentPlan} onSelectPlan={setCurrentPlan} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Shield className="mr-2 h-5 w-5" />
                Secure Billing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center space-x-4 rounded-md border p-4">
                <Lock className="h-5 w-5 text-muted-foreground" />
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">Your payment information is secure</p>
                  <p className="text-sm text-muted-foreground">
                    We use industry-standard encryption to protect your payment details
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-8 pt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <FileText className="mr-2 h-5 w-5" />
                Billing History
              </CardTitle>
              <CardDescription>View and download your past invoices</CardDescription>
            </CardHeader>
            <CardContent>
              <InvoiceList />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
