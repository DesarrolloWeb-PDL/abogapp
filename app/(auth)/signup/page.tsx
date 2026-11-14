import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Crear una cuenta" };

export default function SignupPage() {
  return (
    <Card>
      <CardHeader
        title="Creá tu cuenta"
        description="Sin tarjeta de crédito. Creás tu estudio en minutos."
      />
      <CardBody>
        <SignupForm />
      </CardBody>
    </Card>
  );
}
