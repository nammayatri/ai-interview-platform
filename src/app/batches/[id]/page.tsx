"use client";

import { useParams } from "next/navigation";
import { BatchDetailPage } from "@/components/batches/Batches";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <BatchDetailPage id={id} />;
}
