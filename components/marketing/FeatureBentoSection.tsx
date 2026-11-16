import { getTranslations } from "next-intl/server";

import { FeatureBento } from "./FeatureBento";
import { featureMockLabels } from "./feature-mock-settings";

/**
 * Server half of the Features bento: resolves the mocks' labels from the
 * dashboard's own namespaces (VoiceBrick, PersonaBrick) so only those
 * strings reach the browser, not the namespaces (i18n/public-namespaces).
 */
export async function FeatureBentoSection() {
  const [voice, persona] = await Promise.all([getTranslations("VoiceBrick"), getTranslations("PersonaBrick")]);
  const mock = featureMockLabels(
    (key) => voice(key as never),
    (key) => persona(key as never),
  );
  return <FeatureBento mock={mock} />;
}
