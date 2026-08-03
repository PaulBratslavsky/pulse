import type { Schema, Struct } from '@strapi/strapi';

export interface SharedLeadProfile extends Struct.ComponentSchema {
  collectionName: 'components_shared_lead_profiles';
  info: {
    description: 'Human-supplied identity for a lead. Scoring says WHO is interesting; this says who they actually are and how to reach them. Its existence IS the qualification \u2014 the component stores nothing until a person decides someone is worth working, so no separate flag can drift out of sync with it.';
    displayName: 'Lead Profile';
  };
  attributes: {
    company: Schema.Attribute.String;
    companyDomain: Schema.Attribute.String;
    email: Schema.Attribute.Email;
    intentSummary: Schema.Attribute.Text;
    researchedAt: Schema.Attribute.DateTime;
    researchedBy: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::users-permissions.user'
    >;
    role: Schema.Attribute.String;
    sources: Schema.Attribute.JSON;
    startedAt: Schema.Attribute.DateTime;
  };
}

export interface SharedOutcome extends Struct.ComponentSchema {
  collectionName: 'components_shared_outcomes';
  info: {
    description: 'How a response landed';
    displayName: 'Outcome';
  };
  attributes: {
    notes: Schema.Attribute.Text;
    recordedAt: Schema.Attribute.DateTime;
    result: Schema.Attribute.Enumeration<
      ['resolved', 'positive-turn', 'no-reaction', 'escalated']
    >;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'shared.lead-profile': SharedLeadProfile;
      'shared.outcome': SharedOutcome;
    }
  }
}
