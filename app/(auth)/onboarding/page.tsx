import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Configuración inicial" };

export default function OnboardingPage() {
  return (
    <Card>
      <CardHeader
        title="Configuración inicial"
        description="Cinco pasos para dejar tu estudio listo para usar."
      />
      <CardBody>
        <OnboardingWizard />
      </CardBody>
    </Card>
  );
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
