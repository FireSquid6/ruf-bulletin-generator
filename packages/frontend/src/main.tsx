import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Workspace } from "./components/Workspace";
import { SignIn } from "./pages/SignIn";
import { Register } from "./pages/Register";
import { Invitations } from "./pages/Invitations";
import "./styles/style.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><Routes><Route path="/sign-in" element={<SignIn />} /><Route path="/register" element={<Register />} /><Route path="/invitations" element={<Invitations />} /><Route path="/credentials" element={<Workspace credentials />} /><Route path="/songs" element={<Workspace />} /><Route path="*" element={<Workspace />} /></Routes></BrowserRouter></QueryClientProvider></React.StrictMode>);
