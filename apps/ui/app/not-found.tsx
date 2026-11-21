import Link from "next/link";
import { SearchX } from "@/components/icons";
import { Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="wrap pt-10">
      <div className="card">
        <Empty icon={SearchX} title="Not found">
          This project, analysis, file or rule is not in the reports folder.{" "}
          <Link className="link" href="/">
            Back to the projects
          </Link>
          .
        </Empty>
      </div>
    </div>
  );
}
