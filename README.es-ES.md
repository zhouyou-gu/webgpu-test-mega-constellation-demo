

# 🛰️ Mega-Constellation Browser Twin
## Un visualizador 3D de LISL Starlink para la web, priorizando WebGPU

*Toda la constelación en una sola pestaña del navegador. Los satélites, los terminales láser y los enlaces que tienen en cuenta los terminales se renderizan en tiempo real con WebGPU (y con un respaldo en CPU cuando sea necesario).* 

Este proyecto traslada la experiencia del proyecto original **Mega-Constellation Digital Twin** a un stack nativo del navegador, para que estudiantes y revisores puedan ejecutarlo directamente desde una URL (incluyendo GitHub Pages).

## Por qué este proyecto es importante 🌌

Resulta difícil explicar las grandes constelaciones en LEO con gráficas estáticas.
Este gemelo web ofrece una forma interactiva y compartible de inspeccionar:
- el movimiento de los satélites y la geometría de las capas orbitales
- las restricciones de los terminales láser direccionales (4 terminales por satélite)
- el emparejamiento dinámico de enlaces inter-satelitales

El objetivo es ofrecer utilidad educativa e investigativa sin necesidad de configurar Python/OpenGL localmente.

## Características ✨

- **Ruta de renderizado WebGPU** para una visualización fluida en el navegador
- **Ruta de respaldo en CPU** cuando WebGPU no está disponible
- **Simulación basada en Web Workers** para propagación y emparejamiento de enlaces
- **Textura de la Tierra + rotación alineada con el marco de referencia** para coincidir con el comportamiento del código original
- **Enlaces que considerantienen en cuenta los terminales**
  - una conexión se muestra como dos segmentos de colores
  - el color de cada segmento indica qué terminal se usa en ese satélite
- **Visualización de satélites/LCT alineada con el código original**
  - 4 direcciones de terminal LCT por satélite
  - trazos de terminales más gruesos que los de los enlaces
  - el grosor de las líneas/terminales escala con el zoom
- **Ajustes de cámara y UX**
  - configuración inicial de la cámara similar a la del original
  - órbita + zoom con rueda/pellizco
  - límite de zoom para evitar que la cámara cruce la Tierra
- **HUD y controles**
  - título fijo con línea de autor/supervisor
  - un panel de estado plegable
  - control deslizante de velocidad temporal (`x1` a `x30`)
  - reinicio de la simulación a la hora real actual

## Comportamiento de la demostración 🎥

La aplicación carga una instantánea TLE de Starlink desde `public/data/tle/`, propaga satélites en los workers, calcula candidatos LISL factibles y luego renderiza los enlaces emparejados de forma continua.

Convenciones del modelo visual:
- La Tierra y los satélites se encuentran en un marco fijo en el espacio, consistente con la intención del modelo original
- cada satélite tiene cuatro terminales direccionales (frente/atrás/derecha/izquierda)
- los enlaces válidos se dibujan según los colores de los pares de terminales

## Glosario rápido 📚

- **TLE**: Datos orbitales de dos líneas (Two-Line Element)
- **LISL**: Enlace Láser Inter-Satelital (Laser Inter-Satellite Link)
- **LCT**: Terminal de Comunicación Láser (Laser Communication Terminal)
- **LEO**: Órbita Terrestre Baja (Low Earth Orbit)

## Artículos de investigación 📖

Este gemelo web sigue la dirección de investigación del proyecto original:

1. [Duality-Guided Graph Learning for Real-Time Joint Connectivity and Routing in LEO Mega-Constellations](https://arxiv.org/abs/2601.21921)
2. [Joint Laser Inter-Satellite Link Matching and Traffic Flow Routing in LEO Mega-Constellations via Lagrangian Duality](https://arxiv.org/abs/2601.21914)

**BibTeX:**

```bibtex
@article{gu2026duality,
   title={Duality-Guided Graph Learning for Real-Time Joint Connectivity and Routing in LEO Mega-Constellations},
   author={Gu, Zhouyou and Choi, Jinho and Quek, Tony Q. S. and Park, Jihong},
   journal={arXiv preprint arXiv:2601.21921},
   year={2026}
}

@article{gu2026joint,
   title={Joint Laser Inter-Satellite Link Matching and Traffic Flow Routing in LEO Mega-Constellations via Lagrangian Duality},
   author={Gu, Zhouyou and Park, Jihong and Choi, Jinho},
   journal={arXiv preprint arXiv:2601.21914},
   year={2026}
}
```

## Estructura del repositorio 📂

- `src/app/bootstrap.ts` — inicio, selección de modo, reloj de ejecución, conexión de workers
- `src/gpu/renderer.ts` — renderizador WebGPU
- `src/fallback/cpu-render.ts` — renderizador de respaldo Canvas/CPU
- `src/sim/propagator.worker.ts` — worker de propagación de satélites
- `src/sim/link.worker.ts` — worker de candidatos LISL + emparejamiento
- `src/ui/overlay.ts` — título, estado plegable, controles
- `src/styles.css` — estilos de HUD y diseño responsivo
- `public/data/tle/` — instantáneas TLE + metadatos
- `scripts/` — scripts de validación visual, FPS y UX

## Inicio rápido 🚀

```bash
npm install
npm run dev
```

Luego, abre la URL local de Vite.

## Compilar y previsualizar

```bash
npm run build
npm run preview
```

La aplicación está configurada para alojamiento estático (`base: './'`) y es compatible con GitHub Pages.

## Actualización de instantáneas TLE 🔄

Actualización manual:

```bash
npm run update:tle
```

Genera:
- `public/data/tle/starlink.latest.tle.gz`
- `public/data/tle/starlink.latest.meta.json`

Flujo de trabajo de actualización automatizada:
- `.github/workflows/update-tle.yml`

## Controles 🎮

- **Arrastrar**: orbitar cámara
- **Rueda / pellizco**: zoom
- **Doble clic**: restablecer vista de la cámara
- **Control deslizante de velocidad temporal**: establecer velocidad de simulación (`x1` a `x30`)
- **Restablecer a hora real**: reanclar la época de la simulación a la hora UTC actual

## Notas de configuración 🎛️

Los parámetros de ejecución comunes incluyen:
- Distancia máxima LISL: `3000 km`
- Campo de visión: `+/-15 deg`
- Escala temporal inicial: `x10`

Estos valores se muestran en el panel de estado y son utilizados por la lógica de emparejamiento del worker.

## Validación y pruebas ✅

Verificaciones principales utilizadas durante el desarrollo:

```bash
npm run typecheck
npm run build
node scripts/pw-visual-verify.mjs
node scripts/pw-visual-iterate.mjs
node scripts/pw-fps-test.mjs
node scripts/pw-ux-matrix.mjs
```

Áreas de enfoque:
- comportamiento de los modos GPU/CPU
- paridad visual con capturas de pantalla del original
- comportamiento de zoom/rotación de la cámara
- calidad de la interacción en escritorio y móvil

## Consejos de rendimiento 🚄

- Prefiere un navegador con WebGPU habilitado para un mejor rendimiento.
- Mantén el respaldo en CPU para compatibilidad, pero espera un FPS menor a escala completa.
- Reduce la velocidad de simulación si tu dispositivo tiene limitaciones térmicas.

## Problemas comunes y soluciones 🆘

- **WebGPU no disponible**: la aplicación entra automáticamente en modo de respaldo en CPU.
- **FPS bajo en modo CPU**: reduce la velocidad temporal; mantén una pestaña activa.
- **Sin textura de la Tierra**: asegúrate de que los archivos en `public/data/tle/` y los activos estáticos estén presentes después de la compilación.

## GitHub Pages 🌐

Si se publica desde este repositorio, la URL esperada es:

- `https://zhouyou-gu.github.io/webgpu-test-mega-constellation-demo/`

## Atribución

Proyecto de referencia original:
- `zhouyou-gu/mega-constellation-demo`

Atribución del título de la UI utilizada en esta aplicación:
- **Auth.: Z. Gu, Supr.: J. Park, Aff.: SUTD**
