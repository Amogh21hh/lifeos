import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 py-20 text-center">
      <Compass className="size-8 text-muted" />
      <h1 className="text-lg font-semibold text-fg">Not found</h1>
      <p className="text-sm text-muted">This record doesn’t exist or belongs to another account.</p>
      <Link href="/" className={buttonVariants({ variant: "primary" })}>
        Back to Today
      </Link>
    </div>
  );
}
