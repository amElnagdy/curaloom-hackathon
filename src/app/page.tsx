import { redirect } from "next/navigation";

// The plan is the home of the app.
export default function Home() {
  redirect("/plan");
}
