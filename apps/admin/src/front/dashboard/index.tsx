import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Texts } from "../i18n";
import { RSC } from "../resource";

export function DashboardScreen({ text }: { text: Texts }) {
  return <Card><CardHeader><CardTitle>{text[RSC.ADMIN_OVERVIEW_TITLE]}</CardTitle></CardHeader><CardContent><p>{text[RSC.ADMIN_OVERVIEW_MESSAGE]}</p></CardContent></Card>;
}
