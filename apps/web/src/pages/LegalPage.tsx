type LegalDoc = 'cgu' | 'confidentialite' | 'mentions-legales';

const TITLES: Record<LegalDoc, string> = {
  cgu: "Conditions générales d'utilisation",
  confidentialite: 'Politique de confidentialité',
  'mentions-legales': 'Mentions légales',
};

export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-2xl font-bold mb-2">{TITLES[doc]}</h1>
      <div className="mb-8 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
        <strong>Brouillon.</strong> Ce texte est une base de travail rédigée à partir du cahier des
        charges ; il n'a pas été relu par un juriste et ne doit pas être considéré comme définitif
        avant validation professionnelle (notamment sur la conformité à la loi ivoirienne n° 2013-450
        et les exigences de l'ARTCI).
      </div>
      <div className="prose prose-slate max-w-none space-y-6 text-sm text-slate-700">
        {doc === 'cgu' && <Cgu />}
        {doc === 'confidentialite' && <Confidentialite />}
        {doc === 'mentions-legales' && <MentionsLegales />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-semibold text-base text-slate-900 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Cgu() {
  return (
    <>
      <Section title="1. Objet">
        <p>
          Tech Assist met en relation des clients (particuliers et entreprises) avec des techniciens
          indépendants partenaires, pour du dépannage informatique à distance ou sur place. Les
          présentes conditions régissent l'utilisation du site et des outils associés.
        </p>
      </Section>
      <Section title="2. Commande et paiement">
        <p>
          Toute session d'assistance à distance ou de diagnostic est payée avant son démarrage
          (Mobile Money). Aucune session ne débute sans confirmation de paiement.
        </p>
        <p>
          Si le problème signalé s'avère hors du périmètre du dépannage à distance (panne
          matérielle, dommage physique), la session est close et une solution de remboursement, de
          report ou d'intervention sur place est proposée — les règles précises de remboursement
          restent à finaliser.
        </p>
      </Section>
      <Section title="3. Déroulement d'une session">
        <p>
          Le partage d'écran puis la prise de contrôle à distance ne démarrent qu'après un
          consentement explicite et distinct du client, donné en deux étapes. Un bandeau visible
          indique en permanence qu'une session est en cours, avec un bouton d'arrêt immédiat
          accessible à tout moment.
        </p>
        <p>Chaque session a une durée maximale annoncée au moment de la commande.</p>
      </Section>
      <Section title="4. Engagements du technicien">
        <p>
          Le technicien s'engage à ne jamais demander de mot de passe bancaire ou de code
          confidentiel de paiement, à ne consulter les fichiers personnels du client que si
          strictement nécessaire à la résolution du problème signalé, et à respecter la
          confidentialité des informations rencontrées durant la session.
        </p>
        <p>Tout manquement peut entraîner la suspension du compte technicien.</p>
      </Section>
      <Section title="5. Abonnements entreprise (PME)">
        <p>
          Les entreprises souscrivant un abonnement mensuel bénéficient d'un nombre d'assistances
          incluses selon leur palier ; au-delà, les assistances supplémentaires sont facturées au
          tarif à l'acte en vigueur. L'installation d'un agent permanent sur les postes de
          l'entreprise nécessite l'accord écrit préalable d'un représentant habilité.
        </p>
      </Section>
      <Section title="6. Responsabilité">
        <p>
          Tech Assist met en œuvre des moyens raisonnables pour assurer la qualité du service, sans
          garantir la résolution de tout problème. La responsabilité de Tech Assist et de ses
          techniciens partenaires ne saurait être engagée au-delà des limites prévues par la loi
          applicable. [À préciser avec un juriste : plafond de responsabilité, garanties.]
        </p>
      </Section>
      <Section title="7. Droit applicable">
        <p>
          Les présentes conditions sont soumises au droit ivoirien. Tout litige relève, à défaut de
          règlement amiable, des juridictions compétentes de Côte d'Ivoire.
        </p>
      </Section>
    </>
  );
}

function Confidentialite() {
  return (
    <>
      <Section title="1. Données collectées">
        <p>
          Selon l'usage du service, Tech Assist peut collecter : numéro de téléphone et nom du
          client, description du problème rencontré et réponses au questionnaire de diagnostic,
          journaux d'une session d'assistance (horodatage, actions de contrôle, transferts de
          fichiers), et pour les entreprises abonnées, un inventaire technique des postes couverts
          (espace disque, état de l'antivirus, mises à jour).
        </p>
      </Section>
      <Section title="2. Utilisation du diagnostic assisté par IA">
        <p>
          Lorsqu'un diagnostic est demandé, la description du problème peut être transmise à un
          service d'intelligence artificielle tiers pour analyse. Si ce service est indisponible, un
          moteur de diagnostic local prend le relais sans transmission à un tiers. Aucune information
          de paiement n'est jamais transmise à ce service.
        </p>
      </Section>
      <Section title="3. Base légale et autorité de contrôle">
        <p>
          Le traitement de ces données est régi par la loi ivoirienne n° 2013-450 relative à la
          protection des données à caractère personnel, sous l'autorité de l'Autorité de Régulation
          des Télécommunications de Côte d'Ivoire (ARTCI). [À compléter : référence de la déclaration
          ou de l'autorisation de traitement une fois obtenue.]
        </p>
      </Section>
      <Section title="4. Durée de conservation">
        <p>
          Les données liées à une session sont conservées pour la durée nécessaire au traitement des
          litiges éventuels et aux obligations comptables, puis supprimées ou anonymisées. [Durées
          précises à définir avec un juriste.]
        </p>
      </Section>
      <Section title="5. Vos droits">
        <p>
          Conformément à la réglementation applicable, vous disposez d'un droit d'accès, de
          rectification et de suppression de vos données. Pour l'exercer, contactez-nous [coordonnées
          à compléter].
        </p>
      </Section>
      <Section title="6. Sous-traitants et hébergement">
        <p>
          Les données sont hébergées chez des prestataires techniques (hébergement du site et de la
          base de données, agrégateur de paiement Mobile Money une fois choisi, service de diagnostic
          IA). Chacun n'accède qu'aux données strictement nécessaires à sa mission.
        </p>
      </Section>
    </>
  );
}

function MentionsLegales() {
  return (
    <>
      <Section title="Éditeur du site">
        <p>
          [À compléter : raison sociale, forme juridique, numéro RCCM, siège social, capital social
          le cas échéant.]
        </p>
      </Section>
      <Section title="Directeur de la publication">
        <p>[À compléter.]</p>
      </Section>
      <Section title="Contact">
        <p>[À compléter : adresse e-mail et/ou numéro de téléphone de contact.]</p>
      </Section>
      <Section title="Hébergement">
        <p>Site et API hébergés par Render (render.com).</p>
      </Section>
    </>
  );
}
