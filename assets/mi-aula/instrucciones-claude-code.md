# Instrucciones para Claude Code: dashboard del alumno EMN

Archivos en esta carpeta (claudebridge):
- `dashboard-alumno.html`: el diseño final. Es la fuente de verdad.
- `dashboard-alumno-referencia.png`: captura del resultado esperado a 1920 px de ancho.

## Tarea
Integra `dashboard-alumno.html` en mi web de GitHub Pages (repo emnlatam) como `dashboard.html`,
respetando el estilo del resto del sitio.

## Reglas
- Cópialo EXACTAMENTE igual: mismo orden de bloques, textos, colores, tipografías (Inter y
  Source Serif 4), tamaños y espacios. No rediseñes ni "mejores" nada.
- No agregues librerías ni frameworks. Solo HTML, CSS y JS planos.
- Todos los botones y el dropdown quedan sin función por ahora (solo visuales).
- Los datos de ejemplo (nombre, instrumento, horas, porcentajes, fechas, tareas) quedan tal cual.
  Están en la función `getData()` al final del archivo, para reemplazarlos después por datos reales.
- La plantilla HTML está dentro de `<script type="text/x-template" id="tpl">` y un renderizador
  pequeño al final del archivo la repite para calendario, tareas, barras y gráfico de líneas.
  Conserva ese mecanismo; si prefieres HTML estático, expándelo sin cambiar el resultado visual.
- La barra de navegación superior (Practice Lab, Ask BerkliBot, + Cursos, Administrar, Mi Aula,
  Dany Zare) debe quedar igual al resto de la web.

## Al terminar
Abre la página en el navegador a 1920 px de ancho, compárala con `dashboard-alumno-referencia.png`
y dime cualquier diferencia que veas (espacios, colores, tipografía, orden).
