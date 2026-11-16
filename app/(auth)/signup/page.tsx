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

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
