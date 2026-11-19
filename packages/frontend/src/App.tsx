import { Route, Routes } from "react-router";
import { Workspace } from "./components/Workspace";
import { SignIn } from "./pages/SignIn";
import { Register } from "./pages/Register";
import { ForgotPassword, ResetPassword, VerifyEmail } from "./pages/AccountRecovery";
import { Invitations } from "./pages/Invitations";

export function App() {
  return <Routes>
    <Route path="/sign-in" element={<SignIn />} />
    <Route path="/register" element={<Register />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route path="/reset-password" element={<ResetPassword />} />
    <Route path="/verify-email" element={<VerifyEmail />} />
    <Route path="/invitations" element={<Invitations />} />
    <Route path="*" element={<Workspace />} />
  </Routes>;
}
