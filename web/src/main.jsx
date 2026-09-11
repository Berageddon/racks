import React from "react";
import ReactDOM from "react-dom/client";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Play from "./pages/Play";
import Docs from "./pages/Docs";
import { BuyProvider } from "./components/BuyModal";
import { rackTheme } from "./rainbowTheme";
import { wagmiConfig } from "./config";
import "./styles/global.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          modalSize="compact"
          theme={rackTheme}
          appInfo={{ appName: "RACKS", learnMoreUrl: "https://docs.robinhood.com/chain" }}
        >
          <BuyProvider>
            <HashRouter>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<Landing />} />
                  <Route path="play" element={<Play />} />
                  <Route path="docs" element={<Docs />} />
                </Route>
              </Routes>
            </HashRouter>
          </BuyProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>
);