import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <Card>
      <CardHeader
        title="Ingresá a tu cuenta"
        description="Tus expedientes, pruebas y plazos, siempre a mano."
      />
      <CardBody>
        <LoginForm />
      </CardBody>
    </Card>
  );
}
