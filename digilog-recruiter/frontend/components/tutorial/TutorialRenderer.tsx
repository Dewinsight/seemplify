"use client"

import { useTutorial } from "@/hooks/useTutorial"
import { TutorialWizard } from "./TutorialWizard"

/**
 * Global tutorial renderer component that should be included in the root layout
 * This component automatically renders the active tutorial when one is running
 */
export function TutorialRenderer() {
  const tutorial = useTutorial()
  const activeTutorial = tutorial.getActiveTutorial()

  if (!activeTutorial || !tutorial.isActiveTutorialOpen) {
    return null
  }

  return (
    <TutorialWizard
      steps={activeTutorial.steps}
      isOpen={tutorial.isActiveTutorialOpen}
      onClose={tutorial.closeTutorial}
      onComplete={tutorial.completeTutorial}
      tutorialId={activeTutorial.id}
      title={activeTutorial.title}
      description={activeTutorial.description}
      showProgress={activeTutorial.showProgress}
    />
  )
}
