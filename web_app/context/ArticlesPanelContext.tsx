"use client";

import React, { createContext, useContext } from "react";

type ArticlesPanelContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const ArticlesPanelContext = createContext<ArticlesPanelContextValue | null>(null);

export function ArticlesPanelProvider({
  value,
  children,
}: {
  value: ArticlesPanelContextValue;
  children: React.ReactNode;
}) {
  return (
    <ArticlesPanelContext.Provider value={value}>{children}</ArticlesPanelContext.Provider>
  );
}

export function useArticlesPanel(): ArticlesPanelContextValue | null {
  return useContext(ArticlesPanelContext);
}
