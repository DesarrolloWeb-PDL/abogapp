import type { Metadata } from "next";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getDataDriver } from "@/lib/data/driver";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default function LoginPage() {
  // The demo credential hint may only appear while the fake driver runs —
  // with Supabase Auth active it must never render (it is not a credential
  // for the real backend). Computed server-side so client and server agree.
  const showDemoHint = getDataDriver() === "fake";

  return (
    <Card>
      <CardHeader
        title="Ingresá a tu cuenta"
        description="Tus expedientes, pruebas y plazos, siempre a mano."
      />
      <CardBody>
        <LoginForm showDemoHint={showDemoHint} />
      </CardBody>
    </Card>
  );
}

// Opted out of Next 16 instant-navigation validation: this segment reads
// session/runtime data at request time (migration path per docs
// authentication-with-cache-components.md — remove route by route later).
export const instant = false;
