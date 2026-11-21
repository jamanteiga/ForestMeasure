'use strict';
/*
 * Táboa de especies de Galicia.
 *
 * Modelo (todo editable desde a pantalla Prezos > Parámetros):
 *   Altura   H = 1,3 + a · (1 − e^(−b·DAP))          [m, DAP en cm]
 *   Volume   V = π/4 · (DAP/100)² · H · f             [m³, fuste con cortiza]
 *   Peso     P = V · d                                [t, madeira en verde]
 *   Valor    € = P · prezo (€/t)                      [en pé ou cargadeiro]
 *
 * ATENCIÓN: a, b, f, d e os prezos son valores INICIAIS ORIENTATIVOS.
 * Hai que calibralos con tarifas de cubicación locais (IFN, Xunta, empresa
 * compradora) e cos prezos reais de cada mercado.
 */
const GRUPOS = {
    euc: 'Eucaliptos',
    pin: 'Piñeiros',
    con: 'Outras coníferas',
    fro: 'Frondosas autóctonas',
    ofr: 'Outras frondosas',
    inv: 'Invasoras e outras'
};

// Cor do punto no mapa por grupo
const COR_GRUPO = { euc: '#e67e22', pin: '#2d5016', con: '#1e8449', fro: '#8e44ad', ofr: '#2980b9', inv: '#7f8c8d' };

// Prezos iniciais [en pé, cargadeiro] en €/t por grupo (PLACEHOLDER: edítaos)
const PREZO_GRUPO = { euc: [35, 55], pin: [25, 42], con: [25, 40], fro: [15, 30], ofr: [12, 25], inv: [0, 10] };

// id, grupo, nome galego, nome castelán, científico, a, b, f, densidade verde, [prezos propios]
const ESPECIES = [
    // Eucaliptos
    ['e_globulus', 'euc', 'Eucalipto globulus', 'Eucalipto blanco', 'Eucalyptus globulus', 36, 0.040, 0.43, 1.00],
    ['e_nitens', 'euc', 'Eucalipto nitens', 'Eucalipto nitens', 'Eucalyptus nitens', 34, 0.038, 0.43, 0.95],
    ['e_outros', 'euc', 'Outros eucaliptos', 'Otros eucaliptos (camaldulensis, viminalis, etc.)', 'Eucalyptus spp.', 33, 0.040, 0.43, 1.05],
    // Piñeiros
    ['p_pinaster', 'pin', 'Piñeiro do país', 'Pino gallego / marítimo', 'Pinus pinaster', 30, 0.035, 0.45, 0.95],
    ['p_radiata', 'pin', 'Piñeiro insignis', 'Pino radiata / insigne', 'Pinus radiata', 34, 0.038, 0.45, 0.95],
    ['p_sylvestris', 'pin', 'Piñeiro silvestre', 'Pino silvestre', 'Pinus sylvestris', 26, 0.035, 0.46, 0.90],
    ['p_nigra', 'pin', 'Piñeiro negro / laricio', 'Pino laricio / negral', 'Pinus nigra', 26, 0.035, 0.46, 0.90],
    ['p_pinea', 'pin', 'Piñeiro manso', 'Pino piñonero', 'Pinus pinea', 20, 0.035, 0.45, 0.95],
    // Outras coníferas
    ['c_douglas', 'con', 'Pseudotsuga (Douglas)', 'Pino Oregón / Douglas', 'Pseudotsuga menziesii', 42, 0.030, 0.42, 0.85],
    ['c_larix', 'con', 'Larício / Lárix', 'Alerce', 'Larix kaempferi / decidua', 30, 0.035, 0.45, 0.90],
    ['c_sitka', 'con', 'Pícea de Sitka', 'Pícea de Sitka', 'Picea sitchensis', 34, 0.032, 0.45, 0.95],
    ['c_cupres', 'con', 'Cipreste / Chamaecyparis', 'Ciprés / Chamaecyparis', 'Cupressus / Chamaecyparis', 24, 0.035, 0.50, 0.85],
    ['c_teixo', 'con', 'Teixo', 'Tejo', 'Taxus baccata', 12, 0.030, 0.50, 1.00],
    ['c_outras', 'con', 'Outra conífera', 'Otra conífera', 'Pinophyta', 28, 0.035, 0.45, 0.90],
    // Frondosas autóctonas
    ['f_robur', 'fro', 'Carballo', 'Roble carballo', 'Quercus robur', 22, 0.035, 0.48, 1.05, [40, 70]],
    ['f_petraea', 'fro', 'Roble albar', 'Roble albar', 'Quercus petraea', 24, 0.035, 0.48, 1.05, [40, 70]],
    ['f_pyrenaica', 'fro', 'Rebolo', 'Melojo / rebollo', 'Quercus pyrenaica', 16, 0.040, 0.48, 1.05],
    ['f_suber', 'fro', 'Sobreira', 'Alcornoque', 'Quercus suber', 12, 0.040, 0.50, 1.10],
    ['f_ilex', 'fro', 'Aciñeira', 'Encina', 'Quercus ilex', 10, 0.040, 0.50, 1.10],
    ['f_castanea', 'fro', 'Castiñeiro', 'Castaño', 'Castanea sativa', 24, 0.040, 0.47, 0.95, [40, 70]],
    ['f_betula', 'fro', 'Bidueiro', 'Abedul', 'Betula pubescens / celtiberica', 20, 0.045, 0.47, 0.95],
    ['f_alnus', 'fro', 'Ameneiro', 'Aliso / ameneiro', 'Alnus glutinosa', 24, 0.045, 0.47, 0.90],
    ['f_fraxinus', 'fro', 'Freixo', 'Fresno', 'Fraxinus excelsior / angustifolia', 26, 0.040, 0.47, 1.00, [40, 70]],
    ['f_ulmus', 'fro', 'Ulmeiro (olmo)', 'Olmo', 'Ulmus glabra / minor', 22, 0.040, 0.47, 0.95],
    ['f_fagus', 'fro', 'Faia', 'Haya', 'Fagus sylvatica', 28, 0.035, 0.48, 1.00],
    ['f_acer', 'fro', 'Ácer', 'Arce', 'Acer pseudoplatanus', 26, 0.040, 0.47, 0.95],
    ['f_prunus', 'fro', 'Cerdeira brava', 'Cerezo silvestre', 'Prunus avium', 20, 0.045, 0.47, 0.95, [40, 70]],
    ['f_salix', 'fro', 'Salgueiro', 'Sauce', 'Salix spp.', 18, 0.050, 0.45, 0.90],
    ['f_sorbus', 'fro', 'Cerval / Serbal', 'Serbal', 'Sorbus aucuparia / aria', 12, 0.050, 0.45, 1.00],
    ['f_corylus', 'fro', 'Abeleira', 'Avellano', 'Corylus avellana', 8, 0.070, 0.50, 0.95],
    ['f_tilia', 'fro', 'Tileiro', 'Tilo', 'Tilia spp.', 24, 0.040, 0.47, 0.95],
    ['f_populus', 'fro', 'Álamo / Chopo', 'Álamo / chopo', 'Populus spp.', 30, 0.050, 0.44, 0.85],
    ['f_ilexaq', 'fro', 'Acivro', 'Acebo', 'Ilex aquifolium', 10, 0.050, 0.50, 1.00],
    ['f_laurus', 'fro', 'Loureiro', 'Laurel', 'Laurus nobilis', 10, 0.050, 0.50, 1.00],
    ['f_arbutus', 'fro', 'Érbedo', 'Madroño', 'Arbutus unedo', 8, 0.060, 0.50, 1.05],
    // Outras frondosas (cultivadas / introducidas non invasoras)
    ['o_juglans', 'ofr', 'Nogueira', 'Nogal', 'Juglans regia', 20, 0.040, 0.47, 1.00, [40, 70]],
    ['o_platanus', 'ofr', 'Plátano', 'Plátano de sombra', 'Platanus x hispanica', 26, 0.040, 0.47, 1.00],
    ['o_quercusrubra', 'ofr', 'Carballo americano', 'Roble rojo americano', 'Quercus rubra', 26, 0.040, 0.48, 1.05],
    ['o_outras', 'ofr', 'Outra frondosa', 'Otra frondosa', 'Magnoliophyta', 22, 0.040, 0.47, 1.00],
    // Invasoras
    ['i_dealbata', 'inv', 'Mimosa', 'Mimosa', 'Acacia dealbata', 18, 0.050, 0.45, 1.00],
    ['i_melanoxylon', 'inv', 'Acacia negra', 'Acacia negra', 'Acacia melanoxylon', 20, 0.045, 0.45, 1.00],
    ['i_robinia', 'inv', 'Falsa acacia', 'Robinia / falsa acacia', 'Robinia pseudoacacia', 22, 0.045, 0.45, 1.05],
    ['i_outras', 'inv', 'Outra invasora', 'Otra invasora', '—', 18, 0.050, 0.45, 1.00]
].map(r => ({
    id: r[0], g: r[1], gl: r[2], es: r[3], ci: r[4],
    a: r[5], b: r[6], f: r[7], d: r[8],
    pie: (r[9] || PREZO_GRUPO[r[1]])[0],
    carg: (r[9] || PREZO_GRUPO[r[1]])[1]
}));

const ESP_POR_ID = Object.fromEntries(ESPECIES.map(e => [e.id, e]));
function espById(id) { return ESP_POR_ID[id] || ESP_POR_ID['o_outras']; }
