import Link from "next/link";
import { SearchX } from "@/components/icons";
import { Empty } from "@/components/ui";

export default function DocsNotFound() {
  return (
    <div className="card">
      <Empty icon={SearchX} title="Page not found">
        This page is not in the documentation.{" "}
        <Link className="link" href="/docs">
          Back to the introduction
        </Link>
        .
      </Empty>
    </div>
  );
}
