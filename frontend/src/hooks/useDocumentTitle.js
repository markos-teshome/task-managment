import { useEffect } from 'react';

/** Sets the browser tab title (helps people with many tabs and screen-reader users). */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · TeamFlow` : 'TeamFlow';
  }, [title]);
}
