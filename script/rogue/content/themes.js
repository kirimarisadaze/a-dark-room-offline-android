/* SPDX-License-Identifier: MPL-2.0 */
/** Registers the independent Rogue module data. */
(function () {
    'use strict';
    var R = window.Rogue;
    R.CONTENT = R.CONTENT || {};
    R.CONTENT.themes = [null,
        { id: 'embers', built: false, enemy: 'wolf', resources: ['forest', 'quarry', 'hunting', 'spring'] },
        { id: 'village', built: true, enemy: 'raider', resources: ['forest', 'quarry', 'iron', 'spring'] },
        { id: 'marsh', built: false, enemy: 'leech', resources: ['hunting', 'coal', 'forest', 'spring'] },
        { id: 'archive', built: true, enemy: 'sentinel', resources: ['iron', 'quarry', 'hunting', 'coal'] },
        { id: 'fissure', built: false, enemy: 'stalker', resources: ['sulphur', 'iron', 'coal', 'spring'] },
        { id: 'foundry', built: true, enemy: 'drone', resources: ['iron', 'coal', 'quarry', 'hunting'] },
        { id: 'hollow', built: false, enemy: 'mutant', resources: ['crystal', 'sulphur', 'hunting', 'spring'] },
        { id: 'bunker', built: true, enemy: 'warden', resources: ['crystal', 'iron', 'coal', 'spring'] },
        { id: 'shipyard', built: true, enemy: 'machine', resources: ['crystal', 'sulphur', 'iron', 'hunting'] }
    ];
})();
