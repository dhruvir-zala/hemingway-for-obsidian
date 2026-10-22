// Complex word/phrase -> simpler alternatives.
export const SIMPLER: Record<string, string[]> = {
  "a lot of": ["many", "much"],
  "a number of": ["some", "many"],
  "accomplish": ["do", "finish"],
  "accumulate": ["gather"],
  "acquire": ["get"],
  "additional": ["more", "extra"],
  "advantageous": ["helpful"],
  "approximately": ["about"],
  "apparent": ["clear"],
  "as a result of": ["because of"],
  "ascertain": ["find out"],
  "assist": ["help"],
  "assistance": ["help"],
  "at the present time": ["now"],
  "at this point in time": ["now"],
  "attempt": ["try"],
  "beneficial": ["helpful"],
  "capability": ["ability"],
  "cease": ["stop"],
  "commence": ["start", "begin"],
  "comprehend": ["understand"],
  "concerning": ["about"],
  "conclude": ["end"],
  "consequently": ["so"],
  "demonstrate": ["show"],
  "designate": ["name"],
  "determine": ["decide", "find"],
  "disclose": ["show"],
  "discontinue": ["stop"],
  "due to the fact that": ["because"],
  "each and every": ["each"],
  "eliminate": ["end", "cut"],
  "employ": ["use"],
  "enable": ["let"],
  "endeavor": ["try"],
  "erroneous": ["wrong"],
  "evident": ["clear"],
  "excessive": ["too much"],
  "expedite": ["speed up"],
  "facilitate": ["ease", "help"],
  "for the purpose of": ["for"],
  "frequently": ["often"],
  "fundamental": ["basic"],
  "furnish": ["give"],
  "has the ability to": ["can"],
  "implement": ["carry out"],
  "in addition": ["also"],
  "in close proximity": ["near"],
  "in order to": ["to"],
  "in spite of the fact that": ["although"],
  "in the event that": ["if"],
  "in the near future": ["soon"],
  "initiate": ["start"],
  "inquire": ["ask"],
  "is able to": ["can"],
  "locate": ["find"],
  "magnitude": ["size"],
  "methodology": ["method"],
  "modify": ["change"],
  "nevertheless": ["still"],
  "notify": ["tell"],
  "numerous": ["many"],
  "observe": ["see"],
  "obtain": ["get"],
  "optimal": ["best"],
  "participate": ["take part"],
  "permit": ["let"],
  "possess": ["have"],
  "principal": ["main"],
  "prior to": ["before"],
  "proceed": ["go"],
  "purchase": ["buy"],
  "regarding": ["about"],
  "remainder": ["rest"],
  "remuneration": ["pay"],
  "reside": ["live"],
  "residence": ["home"],
  "retain": ["keep"],
  "subsequently": ["later", "then"],
  "sufficient": ["enough"],
  "terminate": ["end"],
  "the majority of": ["most"],
  "therefore": ["so"],
  "transmit": ["send"],
  "utilise": ["use"],
  "utilize": ["use"],
  "verify": ["check"],
  "whereas": ["while"],
  "whether or not": ["whether"],
  "with regard to": ["about"],
};

export const WEAKENERS: string[] = [
  "i believe", "i consider", "i don't believe", "i don't consider", "i don't feel", "i don't suggest",
  "i don't think", "i feel", "i hope to", "i might", "i suggest", "i suppose", "i think",
  "i was wondering", "i will try", "i wonder", "in my opinion", "is kind of", "is sort of",
  "just", "maybe", "perhaps", "possibly", "we believe", "we consider", "we don't believe",
  "we don't consider", "we don't feel", "we don't suggest", "we don't think", "we feel",
  "we hope to", "we might", "we suggest", "we suppose", "we think", "we were wondering",
  "we will try", "we wonder", "a bit", "a little", "kind of", "sort of", "pretty much",
];

export const NOT_ADVERBS = new Set(
  (
    "only family early july apply reply supply rely ally bully belly jelly fly ugly holy lily silly italy " +
    "assembly anomaly butterfly multiply comply imply rally tally jolly folly sly ply lonely lovely friendly " +
    "likely unlikely elderly costly deadly lively orderly curly chilly hilly bubbly billy " +
    "directly currently recently previously surly burly gnarly prickly bristly scholarly stately timely wobbly ghastly ghostly gangly saintly deathly worldly manly womanly brotherly sisterly fatherly motherly daily weekly monthly yearly hourly nightly quarterly emily kelly wally monopoly homily dolly holly molly polly sally wily"
  ).split(" ")
);

export const IRREGULAR_PARTICIPLES = new Set(
  (
    "done made given taken seen known written broken chosen driven eaten fallen forgotten gotten hidden spoken " +
    "stolen thrown worn begun sung shown built bought brought caught found held kept left lost paid sent sold " +
    "taught told thought understood won led shaken drawn flown frozen grown risen ridden torn sworn woven " +
    "bitten beaten blown forgiven hung laid meant met put set shot struck swept wound"
  ).split(" ")
);

export const NOT_PARTICIPLES = new Set(
  (
    "hundred indeed sacred naked wicked kindred hatred speed seed feed bleed breed creed greed proceed exceed " +
    "succeed shed need weed bed red fed wed embed"
  ).split(" ")
);

// Participles that usually act as adjectives ("she was tired"), not passive voice.
export const ADJECTIVAL = new Set(
  (
    "tired excited interested bored scared worried surprised pleased concerned married supposed used " +
    "confused amazed annoyed disappointed embarrassed exhausted frightened inspired motivated relaxed " +
    "satisfied shocked terrified thrilled determined talented experienced advanced limited mixed crowded " +
    "dedicated detailed complicated sophisticated unexpected unprecedented skilled gifted blessed " +
    "wicked naked beloved aged learned crooked rugged ragged"
  ).split(" ")
);
