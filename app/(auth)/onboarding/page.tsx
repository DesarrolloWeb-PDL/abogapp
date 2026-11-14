import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = { title: "Configuración inicial" };

export default function OnboardingPage() {
  return (
    <Card>
      <CardHeader
        title="Configuración inicial"
        description="Tres pasos para dejar tu estudio listo para usar."
      />
      <CardBody>
        <OnboardingWizard />
      </CardBody>
    </Card>
  );
}
