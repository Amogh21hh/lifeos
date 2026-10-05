import { notFound, redirect } from "next/navigation";
import { getWorld } from "@/server/services/context";

/** Universal entity link: resolves any (type, id) to the page that best shows it. */
export default async function EntityRedirect(props: PageProps<"/e/[type]/[id]">) {
  const { type, id } = await props.params;
  const w = await getWorld();
  switch (type) {
    case "goal":
      return redirect(`/goals/${id}`);
    case "project":
      return redirect(`/projects/${id}`);
    case "opportunity":
    case "application":
      return redirect(`/opportunities/${id}`);
    case "person":
      return redirect(`/people/${id}`);
    case "decision":
      return redirect(`/decisions/${id}`);
    case "document":
      return redirect(`/documents/${id}`);
    case "task": {
      const t = w.idx.task.get(id);
      return redirect(t?.projectId ? `/projects/${t.projectId}#task-${id}` : "/projects");
    }
    case "company":
      return redirect(`/people?company=${id}`);
    case "skill":
      return redirect(`/knowledge?tab=graph&focus=skill:${id}`);
    case "memory":
      return redirect(`/knowledge?tab=memory`);
    case "note":
    case "idea":
      return redirect(`/knowledge?tab=notes`);
    case "commitment": {
      const c = w.commitments.find((x) => x.id === id);
      return redirect(c?.toPersonId ? `/people/${c.toPersonId}` : "/people");
    }
    case "message": {
      const m = w.messages.find((x) => x.id === id);
      return redirect(m?.personId ? `/people/${m.personId}` : "/people");
    }
    case "event": {
      const e = w.events.find((x) => x.id === id);
      return redirect(e?.opportunityId ? `/opportunities/${e.opportunityId}` : e?.projectId ? `/projects/${e.projectId}` : e?.personId ? `/people/${e.personId}` : "/");
    }
    case "credential":
    case "course":
      return redirect("/goals");
    case "transaction":
    case "account":
    case "asset":
      return redirect("/finance");
    default:
      notFound();
  }
}
