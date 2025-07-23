//----------------------------------------------------------------------------------------------------//
//---------- Constants ----------//

const DEBUG = false;

const CRITERIA_PATHS = {
    "category": item => item.system?.category,
    "group": item => item.system?.group,
    "level": item => item.system?.level?.value,
    "range": item => item.system?.range,
    "rarity": item => item.system?.traits?.rarity,
    "traits": item => item.system?.traits?.value || [],
    "type": item => item.type
};

const RARITY_ORDER = {
    "common": 0,
    "uncommon": 1,
    "rare": 2,
    "unique": 3
};

const SORT_FUNCTIONS = {
    rarity: (a, b) => (RARITY_ORDER[a] ?? 5) - (RARITY_ORDER[b] ?? 5),
    level: (a, b) => a - b,
    range: (a, b) => a - b,
    default: (a, b) => String(a).localeCompare(String(b))
};

//----------------------------------------------------------------------------------------------------//
//---------- Init Hook ----------//

Hooks.on('init', () => {
    game.settings.register("foundryvtt-pf2e-merchant-maker", "addCriteriaSummary", {
        name: game.i18n.localize("pf2eMerchantMaker.settings.addCriteriaSummary.name"),
        hint: game.i18n.localize("pf2eMerchantMaker.settings.addCriteriaSummary.hint"),
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register("foundryvtt-pf2e-merchant-maker", "closeOnSubmit", {
        name: game.i18n.localize("pf2eMerchantMaker.settings.closeOnSubmit.name"),
        hint: game.i18n.localize("pf2eMerchantMaker.settings.closeOnSubmit.hint"),
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });

    //---------- Item Piles PF2E----------//
    if (game.modules.get("itempiles-pf2e")?.active) {
        game.settings.register("foundryvtt-pf2e-merchant-maker", "itemPilesSetup", {
            name: game.i18n.localize("pf2eMerchantMaker.settings.itemPilesSetup.name"),
            hint: game.i18n.localize("pf2eMerchantMaker.settings.itemPilesSetup.hint"),
            scope: 'world',
            config: true,
            type: Boolean,
            default: false
        });
    };
});

//----------------------------------------------------------------------------------------------------//
//---------- Ready Hook ----------//

Hooks.once('ready', async () => {
    //---------- Get Items from Equipment Compendium ----------//
    const pack = game.packs.get("pf2e.equipment-srd");

    if (!pack) {
        console.error(game.i18n.localize("pf2eMerchantMaker.error.noPack"));
        return;
    };

    const items = await pack.getDocuments();

    if (DEBUG) {
        const sampleSize = 10;
        const sample = [...items]
            .sort(() => 0.5 - Math.random())
            .slice(0, sampleSize);

        console.log("Sample Items:", sample);
    };

    //---------- Build Empty Sets from CRITERIA_PATHS ----------//
    const criteriaSets = Object.fromEntries(
        Object.keys(CRITERIA_PATHS).map(key => [key, new Set()])
    );

    if (DEBUG) {
        console.log("Empty Criteria Sets:", criteriaSets);
    };

    //---------- Populate Criteria Sets from Items ----------//
    for (const item of items) {
        for (const [key, getValue] of Object.entries(CRITERIA_PATHS)) {
            const value = getValue(item);
            if (Array.isArray(value)) {
                value.filter(v => v != null).forEach(v => criteriaSets[key].add(v));
            } else if (value != null) {
                criteriaSets[key].add(value);
            };
        };
    };

    if (DEBUG) {
        console.log("Criteria Sets:", criteriaSets);
    };

    //---------- Sort Criteria Sets ----------//
    const criteria = Object.fromEntries(
        Object.entries(criteriaSets).map(([key, set]) => {
            const array = Array.from(set);
            const sorter = SORT_FUNCTIONS[key] || SORT_FUNCTIONS.default;
            array.sort(sorter);
            return [key, array];
        })
    );

    if (DEBUG) {
        console.log("Sorted Criteria:", criteria);
    };

    //---------- Store Data in Global Variables ----------//
    window.items = items;

    window.criteria = criteria;

    //---------- Ready ----------//
    console.log(game.i18n.localize("pf2eMerchantMaker.logging.ready"));
});


//----------------------------------------------------------------------------------------------------//
//---------- Application ----------//

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class pf2eLootMerchantMaker extends HandlebarsApplicationMixin(ApplicationV2) {
    get title() {
        return game.i18n.localize("pf2eMerchantMaker.name");
    };

    static DEFAULT_OPTIONS = {
        tag: "form",
        form: {
            handler: this.pf2eLootMerchantMakerFormHandler,
            submitOnChange: false,
            closeOnSubmit: false
        },
        id: "foundryvtt-pf2e-merchant-maker-window",
        width: "auto",
        height: "auto",
        resizable: true
    };

    static PARTS = {
        form: { template: "modules/foundryvtt-pf2e-merchant-maker/templates/pf2eMerchantMaker.hbs" },
        footer: { template: "templates/generic/form-footer.hbs" }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);

        context.buttons = [
            { type: "submit", label: game.i18n.localize("pf2eMerchantMaker.window.submit"), icon: "fa-solid fa-hand-holding-dollar" },
            { type: "reset", label: game.i18n.localize("pf2eMerchantMaker.window.reset"), icon: "fa-solid fa-arrow-rotate-left" }
        ];

        context.criteria = window.criteria;

        return context;
    }

    //---------- Form Handler ----------//
    static async pf2eLootMerchantMakerFormHandler(event, form, formData) {
        //---------- Get Selected Include and Exclude Data ----------//
        const data = formData.object;
        const merchantName = data.merchantName?.trim() ? data.merchantName : "New Merchant";
        const items = window.items;

        if (DEBUG) {
            console.log("Form Data:", data);
        };

        //---------- Get Selected Include and Exclude Data ----------//
        const included = {};
        const excluded = {};

        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith("include-") && Array.isArray(value) && value.length > 0) {
                const label = key.replace("include-", "");
                included[label] = value;
            };

            if (key.startsWith("exclude-") && Array.isArray(value) && value.length > 0) {
                const label = key.replace("exclude-", "");
                excluded[label] = value;
            };
        };

        //---------- Map Values as Needed ----------//
        const numberKeys = ["level", "range"];

        for (const key of numberKeys) {
            if (included[key]) included[key] = included[key].map(Number);
            if (excluded[key]) excluded[key] = excluded[key].map(Number);
        };

        if (DEBUG) {
            console.log("Included Criteria:", included);
            console.log("Excluded Criteria:", excluded);
        };

        // ---------- Match Items Based on Criteria ----------//
        const unsortedMatches = items.filter(item => {
            // ---------- Include Criteria ----------//
            for (const [key, allowedValues] of Object.entries(included)) {
                const value = CRITERIA_PATHS[key]?.(item);
                if (value === undefined) return false;

                if (Array.isArray(value)) {
                    if (!allowedValues.some(v => value.includes(v))) return false;
                } else {
                    if (!allowedValues.includes(value)) return false;
                };
            };

            // ---------- Exclude Criteria ----------//
            for (const [key, excludedValues] of Object.entries(excluded)) {
                const value = CRITERIA_PATHS[key]?.(item);
                if (value === undefined) continue;

                if (Array.isArray(value)) {
                    if (excludedValues.some(v => value.includes(v))) return false;
                } else {
                    if (excludedValues.includes(value)) return false;
                };
            };

            return true;
        });

        if (DEBUG) {
            console.log("Unsorted Matches:", unsortedMatches);
        };

        // ---------- Sort Matches by Rarity > Level > Name ----------//
        const sortedMatches = unsortedMatches.sort((a, b) => {
            const rarityA = CRITERIA_PATHS.rarity(a);
            const rarityB = CRITERIA_PATHS.rarity(b);
            const rarityComparison = SORT_FUNCTIONS.rarity(rarityA, rarityB);
            if (rarityComparison !== 0) return rarityComparison;

            const levelA = CRITERIA_PATHS.level(a);
            const levelB = CRITERIA_PATHS.level(b);
            const levelComparison = SORT_FUNCTIONS.level(levelA, levelB);
            if (levelComparison !== 0) return levelComparison;

            const nameA = a.name.toLowerCase();
            const nameB = b.name.toLowerCase();
            return SORT_FUNCTIONS.default(nameA, nameB);
        });

        if (DEBUG) {
            console.log("Sorted Matches:", sortedMatches);
        };

        // ---------- Create Merchant Actor with Sorted Items ----------//
        const sortedMatchesObjects = sortedMatches.map(item => item.toObject());

        const criteriaSummary = {
            Included: included,
            Excluded: excluded
        };

        const systemData = {
            lootSheetType: "Merchant"
        };

        const formattedCriteriaForText = Object.entries(criteriaSummary)
            .map(([section, values]) => {
                return `<strong>${section}:</strong><br>` +
                    Object.entries(values).map(([k, v]) =>
                        `${k}: ${Array.isArray(v) ? v.join(", ") : v}`
                    ).join("<br>");
            }).join("<br><br>");

        if (game.settings.get("foundryvtt-pf2e-merchant-maker", "addCriteriaSummary")) {
            systemData.details = {
                description: `<div data-visibility="gm">${formattedCriteriaForText}</div>\n<hr />\n<p></p>\n`
            };
        };

        const newMerchant = await Actor.implementation.create({
            name: merchantName,
            type: "loot",
            system: systemData,
            items: sortedMatchesObjects
        });

        newMerchant.setFlag(
            "foundryvtt-pf2e-merchant-maker",
            "criteria",
            criteriaSummary
        );

        if (game.modules.get("itempiles-pf2e")?.active) {
            if (game.settings.get("foundryvtt-pf2e-merchant-maker", "itemPilesSetup")) {
                newMerchant.setFlag("item-piles", "data", {
                    type: "merchant",
                    merchantColumns: [
                        {
                            "label": "Rarity",
                            "path": "system.traits.rarity",
                            "formatting": "{#}",
                            "buying": true,
                            "selling": true,
                            "mapping": {
                                "common": "PF2E.TraitCommon",
                                "uncommon": "PF2E.TraitUncommon",
                                "rare": "PF2E.TraitRare",
                                "unique": "PF2E.TraitUnique"
                            }
                        },
                        {
                            "label": "Bulk",
                            "path": "system.bulk.value",
                            "formatting": "{#}",
                            "buying": true,
                            "selling": true,
                            "mapping": {
                                "0": ""
                            }
                        },
                        {
                            "label": "Level",
                            "path": "system.level.value",
                            "formatting": "{#}",
                            "mapping": {},
                            "buying": true,
                            "selling": true
                        }
                    ],
                    infiniteQuantity: true,
                    hideTokenWhenClosed: true,
                    distance: null,
                    enabled: true
                });
            }
        };
    };
};

//----------------------------------------------------------------------------------------------------//
// ---------- Actor Directory Hook ----------//
Hooks.on("renderActorDirectory", (tab, html) => {
    const footer = html.querySelector(".directory-footer.action-buttons");
    if (!footer) return;
    if (footer.querySelector("#foundryvtt-pf2e-merchant-maker")) return;

    footer.insertAdjacentHTML(
        "afterbegin",
        `
        <button id="foundryvtt-pf2e-merchant-maker">
            <i class="fa-solid fa-hand-holding-dollar"></i>
            <span style="font-weight: 400; font-family: var(--font-sans);">${game.i18n.localize("pf2eMerchantMaker.name")}</span>
        </button>
        `
    );

    footer.querySelector("#foundryvtt-pf2e-merchant-maker").onclick = () => {
        new pf2eLootMerchantMaker({ form: { closeOnSubmit: game.settings.get("foundryvtt-pf2e-merchant-maker", "closeOnSubmit") ?? false } }).render(true);
    };
});
