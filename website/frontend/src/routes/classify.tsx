import { createFileRoute } from "@tanstack/react-router"
import LanTree from "../components/LanTree"

export const Route = createFileRoute("/classify")({
  component: LanTree,
})
