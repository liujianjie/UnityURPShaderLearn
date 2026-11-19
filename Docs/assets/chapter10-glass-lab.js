const GlassLab = (() => {
  const size = [320, 200];
  const pixel = [152, 96];
  const originUV = pixel.map((value, axis) => value / size[axis]);
  const bumpUV = [.5, .5];
  const pivot = [1, 1, 1];
  const verticesOS = [[-1, -.4, 0], [1, -.4, 0], [0, .8, 0]];
  const worldAxes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const positionSteps = ['vertex-pos', 'pack-pos', 'interp-pos', 'read-pos'];
  const transformSteps = ['world-to-tangent', 'tangent-to-world'];
  const coordinateSteps = ['frame', 'decode', ...transformSteps, 'matrix', 'combine', 'rows', 'dot', 'normal-result', 'reflection', ...positionSteps, 'view'];
  const seam = 160;
  const brick = { name: '砖红墙', rgb: [.46, .112, .064] };
  const blue = { name: '蓝墙', rgb: [.047, .226, .37] };
  const faces = {
    '+X': { name: '琥珀窗', rgb: [.70, .34, .10] },
    '−X': { name: '紫窗', rgb: [.27, .21, .48] },
    '+Y': { name: '天顶', rgb: [.20, .53, .44] },
    '−Y': { name: '地板', rgb: [.33, .20, .12] },
    '+Z': { name: '青窗', rgb: [.12, .43, .47] },
    '−Z': { name: '灰窗', rgb: [.31, .33, .38] }
  };
  const tint = [.88, .92, 1];
  const radians = degrees => degrees * Math.PI / 180;
  const unit = vector => {
    const length = Math.hypot(...vector);
    return vector.map(value => value / length);
  };
  const dot = (left, right) => left.reduce((sum, value, axis) => sum + value * right[axis], 0);
  const addScaled = (point, direction, scale = 1) => point.map((value, axis) => value + scale * direction[axis]);
  const number = (value, places = 2) => Number(value.toFixed(places)).toString();
  const tuple = (vector, places = 2) => `(${vector.map(value => number(value, places)).join(', ')})`;
  const cssColor = rgb => `rgb(${rgb.map(channel => Math.round(255 * (
    channel <= .0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - .055
  ))).join(', ')})`;

  function measure({ tilt, turn, distortion, amount, cameraX }) {
    const lean = Math.sin(radians(tilt));
    const packedNormal = [.5 + .4 * lean, .5 + .3 * lean, 0, 1];
    const planarNormal = [2 * packedNormal[0] * packedNormal[3] - 1, 2 * packedNormal[1] - 1];
    const planarLengthSquared = dot(planarNormal, planarNormal);
    const planarLength = Math.sqrt(planarLengthSquared);
    const outward = Math.max(1e-16, Math.sqrt(1 - Math.min(1, planarLengthSquared)));
    const ts = [...planarNormal, outward];
    const spin = radians(turn);
    const tangent = [Math.cos(spin), 0, -Math.sin(spin)];
    const bitangent = [0, 1, 0];
    const normal = [Math.sin(spin), 0, Math.cos(spin)];
    const basisRows = tangent.map((value, axis) => [value, bitangent[axis], normal[axis]]);
    const verticesWS = verticesOS.map(vertex => basisRows.map((row, axis) => dot(row, vertex) + pivot[axis]));
    const vertexSlots = verticesWS.map(vertex => basisRows.map((row, axis) => [...row, vertex[axis]]));
    const fragmentSlots = vertexSlots[0].map((row, axis) => row.map((_, slot) =>
      vertexSlots.reduce((sum, vertex) => sum + vertex[axis][slot], 0) / 3));
    const rows = fragmentSlots.map(row => row.slice(0, 3));
    const worldPos = fragmentSlots.map(row => row[3]);
    const worldToTangent = [tangent, bitangent, normal].map(direction => [...direction, -dot(direction, worldPos)]);
    const rawWS = rows.map(row => dot(row, ts));
    const ws = unit(rawWS);
    const camera = [cameraX, 1, 5];
    const viewDelta = addScaled(camera, worldPos, -1);
    const viewLength = Math.hypot(...viewDelta);
    const viewDir = unit(viewDelta);
    const incident = viewDir.map(value => -value);
    const alongNormal = dot(incident, ws);
    const reflected = incident.map((value, axis) => value - 2 * alongNormal * ws[axis]);
    const axis = reflected.reduce((best, value, index) => Math.abs(value) > Math.abs(reflected[best]) ? index : best, 0);
    const face = (reflected[axis] >= 0 ? '+' : '−') + 'XYZ'[axis];
    const offsetPx = ts.slice(0, 2).map(value => value * distortion);
    const offsetUV = offsetPx.map((value, index) => value / size[index]);
    const samplePx = pixel.map((value, index) => value + offsetPx[index]);
    const uv = originUV.map((value, index) => value + offsetUV[index]);
    const wall = samplePx[0] < seam ? brick : blue;
    const reflCol = faces[face].rgb.map((channel, index) => channel * tint[index]);
    const finalCol = reflCol.map((channel, index) => channel * (1 - amount) + wall.rgb[index] * amount);
    return { tilt, turn, distortion, amount, lean, packedNormal, ts, planarLengthSquared, planarLength,
      tangent, bitangent, normal,
      rows, rawWS, ws, verticesWS, vertexSlots, fragmentSlots, worldToTangent,
      worldPos, camera, viewDelta, viewLength, viewDir, incident, alongNormal, reflected, axis, face,
      offsetPx, offsetUV, samplePx, uv, wall, refrCol: wall.rgb, reflCol, finalCol };
  }

  function normalLegs(data) {
    let from = data.worldPos;
    return [data.tangent, data.bitangent, data.normal].map((direction, index) => {
      const weight = data.ts[index];
      const delta = direction.map(value => value * weight);
      const to = addScaled(from, delta);
      const leg = {from, to, delta, weight};
      from = to;
      return leg;
    });
  }

  function coordinateSketch(step, data, focus) {
    const origin = [0, 0, 0];
    const {worldPos: point, camera, tangent, bitangent, normal, rawWS, viewDir, verticesWS} = data;
    const {axis, localAxis, column, reading} = focus;
    const localAxes = [[tangent, 'T', 't'], [bitangent, 'B', 'b'], [normal, 'N', 'n']];
    const onPosition = positionSteps.includes(step);
    const strokes = [], labels = [], markers = [];
    const label = (text, at, color = 'ink', dx = 7, dy = -18) => labels.push({text, at, color, dx, dy});
    const line = (points, color, dashed = false) => strokes.push({points, color, dashed});
    const arrow = (from, to, color, width) => strokes.push({points:[from, to], color, arrow:true, width});
    const mark = (at, color = 'ink') => markers.push({at, color});
    const pointName = onPosition || step === 'reflection' ? 'P · worldPos' : 'P';

    function axesAt(center, selected = -1) {
      worldAxes.forEach((direction, index) => {
        const end = addScaled(center, direction, .72);
        const color = index === selected ? 'sample' : 'muted';
        arrow(center, end, color, .012);
        label('XYZ'[index], end, color, 6, -10);
      });
    }

    function worldRoute(start, delta, color, selected = -1) {
      let previous = start;
      delta.forEach((value, index) => {
        if (Math.abs(value) < .0001) {
          if (index === selected) label(`${'XYZ'[index]} 0`, previous, color, 8, 29);
          return;
        }
        const direction = worldAxes[index];
        const next = addScaled(previous, direction, value);
        const active = selected === -1 || index === selected;
        const ink = active ? color : 'muted';
        if (active) arrow(previous, next, ink, .021);
        else line([previous, next], ink, true);
        const signed = (value > 0 ? '+' : '') + number(value, 3);
        label(`${'XYZ'[index]} ${signed}`, addScaled(previous, direction, value * .58), ink, 7, 12);
        previous = next;
      });
    }

    function composeNormal(showWeights, count = 3) {
      const visibleLegs = normalLegs(data).slice(0, count);
      visibleLegs.forEach(({from, to, delta, weight}, index) => {
        const [, name, color] = localAxes[index];
        if (Math.abs(weight) <= .025) return;
        arrow(from, to, color, .018);
        if (showWeights) label(`${number(weight, 3)} ${name}`, addScaled(from, delta, .56), color, 7, 9);
      });
      return visibleLegs.at(-1).to;
    }

    if (!['basis', 'decode', 'combine', 'dot', 'view', 'bounce'].includes(step)) {
      if (step !== 'reflection') axesAt(origin, ['pack-pos', 'read-pos', 'rows'].includes(step) ? axis : -1);
      mark(origin, 'muted');
      label('O', origin, 'muted', -20, 7);
    }

    if (step === 'basis') {
      const mappedTip = addScaled(point, data.ws);
      if (data.tilt) {
        const meshTip = addScaled(point, normal);
        arrow(point, meshTip, 'n', .022);
        label('N', meshTip, 'n');
      }
      arrow(point, mappedTip, 'mapped', .029);
      label(data.tilt ? 'bump' : 'bump = N', mappedTip, 'mapped');
    } else if (step === 'reflection') {
      worldRoute(origin, point, 'sample');
    } else if (onPosition) {
      line([...verticesWS, verticesWS[0]], 't');
      verticesWS.forEach((vertex, index) => {
        const selected = index === 0 && ['vertex-pos', 'pack-pos'].includes(step);
        const color = selected ? 'sample' : 't';
        mark(vertex, color);
        label(selected ? 'Q0 · vert' : 'Q' + index, vertex, color, 7, 6);
      });
      if (step === 'read-pos') {
        worldRoute(origin, point, 'sample', axis);
      } else if (step === 'pack-pos') {
        worldRoute(origin, verticesWS[0], 'sample', axis);
      } else if (step === 'vertex-pos') {
        const firstTurn = addScaled(pivot, tangent, verticesOS[0][0]);
        line([origin, pivot], 'sample', true);
        arrow(pivot, firstTurn, 't', .023);
        arrow(firstTurn, verticesWS[0], 'b', .023);
        label('−1 · 模型 X', addScaled(pivot, tangent, -.65), 't', -12, -22);
        label('−0.4 · 模型 Y', verticesWS[0], 'b', 8, 27);
      } else if (step === 'interp-pos') {
        const midpoint = verticesWS[0].map((value, index) => (value + verticesWS[1][index]) / 2);
        mark(midpoint, 'sample');
        label('M · 边中点', midpoint, 'sample', -12, 12);
        line([midpoint, verticesWS[2]], 'muted', true);
        arrow(midpoint, point, 'sample', .024);
        label('全段 1/3', addScaled(midpoint, bitangent, .18), 'sample', -44, -10);
      }
    } else if (step === 'view') {
      line([point, camera], 'ink', true);
      mark(camera);
      label('C · 相机', camera, 'ink', -18, -36);
      const towardsCamera = addScaled(point, viewDir);
      arrow(point, towardsCamera, 'view', .032);
      label('worldViewDir', towardsCamera, 'view', 6, -23);
    } else if (step === 'bounce') {
      const from = addScaled(point, viewDir, 1.55);
      arrow(from, point, 'ink', .022);
      label('入射', from, 'ink', 6, -20);
    } else if (transformSteps.includes(step)) {
      arrow(origin, point, 'sample', .018);
      label('OP', addScaled(origin, point, .5), 'sample', -28, -14);
      localAxes.forEach(([direction, name, color], index) => {
        const end = addScaled(point, direction, .78);
        arrow(point, end, color, step === 'world-to-tangent' && index === localAxis ? .026 : .015);
        label(name, end, color);
      });
      if (step === 'world-to-tangent') {
        const [direction, name, color] = localAxes[localAxis];
        const reading = -data.worldToTangent[localAxis][3];
        const foot = addScaled(origin, direction, reading);
        const start = addScaled(origin, direction, Math.min(0, reading) - .18);
        const end = addScaled(origin, direction, Math.max(.82, reading + .3));
        arrow(start, end, color, .01);
        label(`+${name}`, end, color, 7, -12);
        line([point, foot], color, true);
        if (Math.abs(reading) > .001) {
          arrow(origin, foot, color, .024);
          mark(foot, color);
          label(`${name}·P = ${number(reading, 3)}`, foot, color, 8, 13);
        }
      }
    } else if (step === 'matrix') {
      const [direction, name, color] = localAxes[column];
      localAxes.forEach(([ruler, axisName, axisColor], index) => {
        const end = addScaled(point, ruler);
        if (index !== column) {
          line([point, end], axisColor, true);
          mark(end, axisColor);
          label(axisName, end, axisColor);
        }
      });
      const tip = addScaled(point, direction);
      worldRoute(point, direction, 'sample');
      arrow(point, tip, color, .028);
      mark(tip, color);
      label(`${name} · 走 1 格`, tip, color, 8, -23);
    } else if (step === 'combine') {
      const count = focus.legs + 1;
      const tip = composeNormal(true, count);
      if (count > 1) arrow(point, tip, count === 3 ? 'mapped' : 'sample', .027);
      mark(tip, count === 3 ? 'mapped' : localAxes[count - 1][2]);
      if (tip.some((value, index) => Math.abs(value - point[index]) > .025)) {
        label(count === 3 ? 'Q · 法线箭头尖' : `P${count}`, tip, count === 3 ? 'mapped' : 'ink', 9, -21);
      }
    } else if (step === 'dot') {
      const direction = worldAxes[axis];
      const project = position => addScaled(point, direction, position[axis] - point[axis]);
      const railEnd = addScaled(point, direction, 1.14);
      const legs = normalLegs(data);
      const tip = legs.at(-1).to;
      const projectedTip = project(tip);
      arrow(addScaled(point, direction, -1.14), railEnd, 'muted', .01);
      label(`世界 +${'XYZ'[axis]}`, railEnd, 'muted', 5, -18);

      legs.forEach(({from, to, weight}, index) => {
        const [, , color] = localAxes[index];
        const foot = project(to);
        if (Math.abs(weight) > .025) {
          arrow(from, to, color, .022);
          if (index < 2) {
            mark(to, color);
            label(`P${index + 1}`, to, color, 7, index === 0 ? 9 : -22);
          }
        }
        line([to, foot], color, true);
        mark(foot, color);
      });
      arrow(point, tip, 'mapped', .028);
      label('Q · 粉箭头尖', tip, 'mapped', 8, -22);
      arrow(point, projectedTip, 'sample', .022);
      label(`${'XYZ'[axis]} = ${number(rawWS[axis], 5)}`, projectedTip, 'sample', 6, 11);
    } else if (step === 'normal-result') {
      const tip = addScaled(point, data.ws);
      if (reading === 0) composeNormal(true);
      else worldRoute(point, data.ws, 'sample');
      arrow(point, tip, 'mapped', .028);
      mark(tip, 'mapped');
      label('bump', tip, 'mapped', 9, -23);
    } else {
      if (step === 'rows') {
        const direction = worldAxes[axis];
        const end = addScaled(point, direction, 1.16);
        line([addScaled(point, direction, -1.16), end], 'sample', true);
        arrow(point, addScaled(point, direction), 'sample', .015);
        label(`e_${'XYZ'[axis]} · 世界单位轴`, end, 'sample', 7, 12);
      }
      localAxes.forEach(([direction, name, color], index) => {
        const end = addScaled(point, direction);
        if (step === 'frame' || step === 'rows') arrow(point, end, color, .024);
        else line([point, end], color, true);
        if (step === 'rows') {
          const projected = addScaled(point, worldAxes[axis], direction[axis]);
          line([end, projected], color, true);
          label(`${name}.${'xyz'[axis]} = ${number(direction[axis], 3)}`, end, color);
        } else if (step !== 'decode' || Math.abs(data.ts[index]) <= .025) {
          label(name, end, color);
        }
      });

      if (step === 'decode') {
        composeNormal(true);
        const tip = addScaled(point, rawWS);
        if (data.planarLength > .025) {
          const foot = addScaled(addScaled(point, tangent, data.ts[0]), bitangent, data.ts[1]);
          mark(foot, 'sample');
          label('H', foot, 'sample', 9, 10);
        }
        arrow(point, tip, 'mapped', .028);
        label('bump · Q', tip, 'mapped', 7, -22);
      }
    }
    mark(point);
    const startName = step === 'vertex-pos' ? 'P · 玻璃原点' :
      step === 'dot' && data.tilt === 0 ? 'P = P1 = P2' : pointName;
    label(startName, point, 'ink', -19, 8);
    return {strokes, labels, markers};
  }

  function diagram(canvas, step, data, focus) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const pen = canvas.getContext('2d');
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    const ink = '#eff4ed', muted = '#b2c4c4', aqua = '#80ebe0', pink = '#ffa2ce', amber = '#ffcb77';

    function segment(start, end, color, weight = 2, dashed = false) {
      pen.beginPath();
      pen.moveTo(...start);
      pen.lineTo(...end);
      pen.strokeStyle = color;
      pen.lineWidth = weight;
      pen.setLineDash(dashed ? [4, 5] : []);
      pen.stroke();
      pen.setLineDash([]);
    }
    function arrow(start, end, color) {
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
      segment(start, end, color, 3);
      for (const side of [-1, 1]) {
        segment(end, [end[0] - 11 * Math.cos(angle + side * .46), end[1] - 11 * Math.sin(angle + side * .46)], color, 3);
      }
    }
    function dotAt(point, radius, fill, outline) {
      pen.beginPath();
      pen.arc(...point, radius, 0, Math.PI * 2);
      pen.fillStyle = fill;
      pen.fill();
      pen.strokeStyle = outline;
      pen.lineWidth = 2;
      pen.stroke();
    }
    function label(text, point, color = ink, align = 'left') {
      pen.font = '600 14px "Microsoft YaHei UI", sans-serif';
      pen.textAlign = align;
      pen.textBaseline = 'middle';
      const length = pen.measureText(text).width;
      const left = align === 'right' ? point[0] - length : align === 'center' ? point[0] - length / 2 : point[0];
      pen.fillStyle = '#112127';
      pen.fillRect(left - 4, point[1] - 11, length + 8, 22);
      pen.fillStyle = color;
      pen.fillText(text, ...point);
    }

    function rightAngle(corner, horizontal, vertical) {
      const edge = [corner[0] + horizontal, corner[1]];
      const opposite = [edge[0], edge[1] + vertical];
      segment(edge, opposite, muted, 1.4);
      segment(opposite, [corner[0], opposite[1]], muted, 1.4);
    }

    if (step === 'frame') {
      const green = '#76d4a0';
      const start = [width / 2, height * .72];
      const length = Math.min(width * .29, height * .49);
      const [normalX, , normalZ] = data.normal;
      const tip = [start[0] + normalX * length, start[1] - normalZ * length];
      const zeroTip = [start[0], start[1] - length];
      const zFoot = [start[0], tip[1]];
      const angle = radians(data.turn);
      const angleRadius = length * .40;
      const side = Math.sign(normalX) || 1;

      segment([20, start[1]], [width - 20, start[1]], '#6ba3b478', 1.5);
      segment([start[0], zeroTip[1] - 6], [start[0], start[1] + 16], '#6ba3b478', 1.5);
      pen.beginPath();
      pen.arc(...start, length, Math.PI, 2 * Math.PI);
      pen.strokeStyle = '#6ba3b454';
      pen.lineWidth = 1.5;
      pen.stroke();
      label('−X', [19, start[1] + 18], muted);
      label('+X', [width - 19, start[1] + 18], muted, 'right');
      label('+Z · 0° 的 N', [start[0], zeroTip[1] - 21], muted, 'center');

      if (data.turn !== 0) {
        segment(start, zeroTip, muted, 1.5, true);
        segment(start, zFoot, aqua, 2, true);
        segment(zFoot, tip, aqua, 2, true);
        pen.beginPath();
        pen.arc(...start, angleRadius, -Math.PI / 2, -Math.PI / 2 + angle, angle < 0);
        pen.strokeStyle = amber;
        pen.lineWidth = 2;
        pen.stroke();
      }
      if (Math.abs(tip[0] - start[0]) > 18 && start[1] - tip[1] > 18) {
        rightAngle(zFoot, side * 10, 10);
      }

      arrow(start, tip, green);
      dotAt(start, 4.5, ink, '#132025');
      label('P', [start[0], start[1] + 21], ink, 'center');
      label('N', [tip[0] + side * 12, tip[1] + (normalZ < .15 ? 20 : 10)], green, side > 0 ? 'left' : 'right');
      if (Math.abs(tip[0] - start[0]) > 49) {
        label(`X ${number(normalX, 3)}`, [(tip[0] + start[0]) / 2, tip[1] - 16], aqua, 'center');
      }
      if (start[1] - tip[1] > 39) {
        label(`Z ${number(normalZ, 3)}`, [start[0] - side * 12, (tip[1] + start[1]) / 2], aqua, side > 0 ? 'right' : 'left');
      }
      label(`θ = ${data.turn}°`, [18, height - 22], amber);
      return;
    }

    if (step === 'decode-foot') {
      const [alongT, alongB] = data.ts;
      const scale = Math.min((width - 115) / .66, (height - 86) / .5, 275);
      const start = [width / 2 - alongT * scale / 2, height / 2 + alongB * scale / 2];
      const elbow = [start[0] + alongT * scale, start[1]];
      const foot = [elbow[0], start[1] - alongB * scale];
      segment([22, start[1]], [width - 22, start[1]], '#6ba3b454', 1);
      segment([start[0], 23], [start[0], height - 23], '#6ba3b454', 1);
      label('+T', [width - 21, start[1] - 15], muted, 'right');
      label('+B', [start[0] + 12, 23], muted);
      if (data.planarLength === 0) {
        dotAt(start, 5, ink, '#132025');
        label('P = H', [start[0] + 10, start[1] + 18], aqua);
        return;
      }
      segment(start, elbow, '#59c6ff', 3);
      segment(elbow, foot, amber, 3);
      segment(start, foot, aqua, 3);
      if (Math.abs(alongT) * scale > 27 && Math.abs(alongB) * scale > 22) {
        const side = Math.sign(alongT);
        const up = Math.sign(alongB);
        rightAngle(elbow, -side * 12, -up * 12);
        label('x', [(start[0] + elbow[0]) / 2, elbow[1] + up * 17], '#59c6ff', 'center');
        label('y', [foot[0] + side * 13, (elbow[1] + foot[1]) / 2], amber, 'center');
        label('PH', [(start[0] + foot[0]) / 2 - side * 12, (start[1] + foot[1]) / 2 - up * 15], aqua, 'center');
      }
      dotAt(start, 5, ink, '#132025');
      dotAt(foot, 4, aqua, '#132025');
      label('P', [start[0] - Math.sign(alongT) * 13, start[1] + 17], ink, 'center');
      label('H', [foot[0] + Math.sign(alongT) * 11, foot[1] - Math.sign(alongB) * 17], aqua, 'center');
      return;
    }

    if (step === 'decode-z') {
      const scale = Math.min((width - 150) / .86, (height - 56) / 2);
      const length = data.planarLength * scale;
      const rise = data.ts[2] * scale;
      const start = [width * .46 - length / 2, height / 2];
      const foot = [start[0] + length, start[1]];
      const tip = [foot[0], foot[1] - rise];
      const insideTip = [foot[0], foot[1] + rise];
      segment([18, start[1]], [width - 18, start[1]], '#6ba3b478', 1.5);
      segment(start, insideTip, muted, 1.5, true);
      segment(foot, insideTip, muted, 1.5, true);
      segment(start, foot, aqua, 3.5);
      segment(foot, tip, '#76d4a0', 3.5);
      arrow(start, tip, pink);
      if (length > 14) rightAngle(foot, -11, -11);
      dotAt(start, 5, ink, '#132025');
      if (length > 12) dotAt(foot, 4, aqua, '#132025');
      dotAt(tip, 4, pink, '#132025');
      dotAt(insideTip, 4, muted, '#132025');
      label('玻璃', [19, start[1] + 16], muted);
      const startLabel = length > 12 ? 'P' : data.planarLength === 0 ? 'P = H' : 'P';
      label(startLabel, [start[0] - 9, start[1] + 17], ink, 'right');
      if (length > 12) label('H', [foot[0] + 8, foot[1] + 15], aqua);
      if (length > 31) label('PH', [(start[0] + foot[0]) / 2, foot[1] - 13], aqua, 'center');
      label('PQ = 1', [start[0] - 10, start[1] - rise * .56], pink, 'right');
      label('z', [foot[0] + 12, foot[1] - rise * .5], '#76d4a0');
      label('Q · 朝外', [tip[0] + 11, tip[1]], pink);
      label('朝里', [insideTip[0] + 11, insideTip[1]], muted);
      return;
    }

    if (step === 'refraction') {
      const scale = Math.min((width - 36) / 172, (height - 50) / 120);
      const project = ([horizontal, vertical]) => [
        width / 2 + (horizontal - pixel[0]) * scale, height / 2 - (vertical - pixel[1]) * scale
      ];
      const split = project([seam, pixel[1]])[0];
      pen.fillStyle = cssColor(brick.rgb);
      pen.fillRect(0, 0, split, height);
      pen.fillStyle = cssColor(blue.rgb);
      pen.fillRect(split, 0, width - split, height);
      for (let column = 0; column <= size[0]; column += 16) {
        const horizontal = project([column, 0])[0];
        segment([horizontal, 0], [horizontal, height], '#ffffff24', 1);
      }
      for (let row = 0; row <= size[1]; row += 16) {
        const vertical = project([0, row])[1];
        segment([0, vertical], [width, vertical], '#ffffff24', 1);
      }
      label('砖红墙', [14, 20]);
      label('蓝墙', [width - 14, 20], ink, 'right');
      label('→ +U　↑ +V', [14, height - 18], muted);
      const start = project(pixel), end = project(data.samplePx);
      const distance = Math.hypot(...data.offsetPx);
      if (distance > 0) {
        segment(start, [end[0], start[1]], '#ffffffae', 1.5, true);
        segment([end[0], start[1]], end, '#ffffffae', 1.5, true);
        if (distance * scale > 14) arrow(start, end, aqua);
      }
      dotAt(start, 8, '#142025', ink);
      dotAt(end, 4.5, aqua, '#142025');
      if (distance === 0) {
        label('A = B', [start[0], start[1] + 23], aqua, 'center');
      } else {
        const forward = data.offsetPx[0] > 0;
        label('A 原位', [start[0], start[1] + (forward ? 23 : -23)], ink, 'center');
        label('B 取色', [end[0], end[1] + (forward ? -23 : 23)], aqua, 'center');
      }
      return;
    }

    if (step === 'mix') {
      const swatches = [[data.reflCol, '倒影'], [data.refrCol, '背景'], [data.finalCol, 'P 的颜色']];
      const block = Math.min(width / 5.5, height / 3, 92);
      swatches.forEach(([color, title], index) => {
        const center = width * (index + .5) / 3;
        pen.fillStyle = cssColor(color);
        pen.fillRect(center - block / 2, (height - block) / 2, block, block);
        label(title, [center, (height + block) / 2 + 24], ink, 'center');
      });
      label(`${Math.round((1 - data.amount) * 100)}%`, [width / 6, (height - block) / 2 - 23], amber, 'center');
      label(`${Math.round(data.amount * 100)}%`, [width / 2, (height - block) / 2 - 23], aqua, 'center');
      return;
    }

    if (step === 'basis') {
      const base = [width / 2, height * .68];
      const length = Math.min(width * .28, height * .43);
      const normalInSlice = [data.lean, -data.ts[2]];
      const alongFace = [data.ts[2], data.lean];
      const tip = addScaled(base, normalInSlice, length);
      const facetSize = Math.min(width * .125, 55);
      const faceStart = addScaled(base, alongFace, -facetSize);
      const faceEnd = addScaled(base, alongFace, facetSize);
      segment([18, base[1]], [width - 18, base[1]], '#78adc4');
      segment(faceStart, faceEnd, pink, 3);
      if (data.tilt) {
        const meshTip = [base[0], base[1] - length];
        arrow(base, meshTip, '#76d4a0');
        label('N', [meshTip[0], meshTip[1] - 17], '#76d4a0', 'center');
        pen.beginPath();
        pen.arc(...base, length * .39, -Math.PI / 2, radians(data.tilt - 90), data.tilt < 0);
        pen.strokeStyle = pink;
        pen.lineWidth = 2;
        pen.stroke();
      }
      const faceCorner = addScaled(base, alongFace, 12);
      const normalCorner = addScaled(base, normalInSlice, 12);
      const squareCorner = addScaled(faceCorner, normalInSlice, 12);
      segment(faceCorner, squareCorner, pink, 1.4);
      segment(squareCorner, normalCorner, pink, 1.4);
      arrow(base, tip, pink);
      dotAt(base, 5, ink, '#132025');
      label('P', [base[0] - 6, base[1] + 22]);
      label(data.tilt ? 'bump' : 'bump = N', [tip[0] + (data.tilt < 0 ? -10 : 10), tip[1] - 4], pink, data.tilt < 0 ? 'right' : 'left');
      label('玻璃网格', [22, base[1] - 14], '#9cd4ec');
      label('贴图描述的小面', [faceEnd[0] + 9, base[1] + 43], pink, 'center');
      return;
    }

    if (step === 'sample') {
      const tileSize = Math.min(width * .27, height * .48);
      const top = height / 2 - tileSize / 2;
      const glassLeft = width * .24 - tileSize / 2;
      const textureLeft = width * .75 - tileSize / 2;
      const centerY = height / 2;
      pen.fillStyle = '#274954';
      pen.fillRect(glassLeft, top, tileSize, tileSize);
      pen.strokeStyle = '#68abc4';
      pen.lineWidth = 1.5;
      pen.strokeRect(glassLeft, top, tileSize, tileSize);
      const cellSize = tileSize / 3;
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          const red = data.packedNormal[0] + (column - 1) * .10;
          const green = data.packedNormal[1] + (1 - row) * .10;
          pen.fillStyle = `rgb(${red * 100}% ${green * 100}% 0%)`;
          pen.fillRect(textureLeft + column * cellSize, top + row * cellSize, cellSize, cellSize);
        }
      }
      pen.strokeStyle = pink;
      pen.lineWidth = 2;
      pen.strokeRect(textureLeft + cellSize, top + cellSize, cellSize, cellSize);
      arrow([glassLeft + tileSize + 13, centerY], [textureLeft - 13, centerY], pink);
      dotAt([width * .24, centerY], 5, ink, '#132025');
      label('P', [width * .24 + 10, centerY - 11]);
      label('玻璃表面', [width * .24, top - 20], '#9cd4ec', 'center');
      label('_BumpMap', [width * .75, top - 20], pink, 'center');
      label(`UV ${tuple(bumpUV)}`, [width * .75, top + tileSize + 22], pink, 'center');
      return;
    }

    if (coordinateSteps.includes(step)) {
      const {strokes, labels, markers} = coordinateSketch(step, data, focus);
      const colors = {ink, muted, t:'#59c6ff', b:amber, n:'#76d4a0', mapped:pink, view:'#c7afff', sample:aqua};
      const flatten = ([x, y, z]) => [.86 * x - .62 * z, -.29 * x - .9 * y - .40 * z];
      const corners = [[-1.36,-.93], [1.36,-.93], [1.36,.93], [-1.36,.93]].map(([horizontal, vertical]) =>
        addScaled(addScaled(data.worldPos, data.tangent, horizontal), data.bitangent, vertical));
      const points = [...corners, ...strokes.flatMap(stroke => stroke.points)].map(flatten);
      const extent = axis => [Math.min(...points.map(point => point[axis])), Math.max(...points.map(point => point[axis]))];
      const [left, right] = extent(0), [top, bottom] = extent(1);
      const scale = Math.min((width - 100) / (right - left), (height - 74) / (bottom - top), height / 2.5);
      const project = point => {
        const [x, y] = flatten(point);
        return [width / 2 + (x - (left + right) / 2) * scale, height / 2 + (y - (top + bottom) / 2) * scale];
      };
      pen.beginPath();
      pen.moveTo(...project(corners[0]));
      corners.slice(1).forEach(point => pen.lineTo(...project(point)));
      pen.closePath();
      pen.fillStyle = '#59c6ff19';
      pen.strokeStyle = '#59c6ff78';
      pen.lineWidth = 1;
      pen.fill();
      pen.stroke();
      for (const stroke of strokes) {
        const points = stroke.points.map(project);
        if (stroke.arrow && Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) > 9) {
          arrow(points[0], points[1], colors[stroke.color]);
        } else {
          points.slice(1).forEach((end, index) => segment(points[index], end, colors[stroke.color], 1.5, stroke.dashed));
        }
      }
      for (const marker of markers) dotAt(project(marker.at), 4, colors[marker.color], '#142025');
      const occupied = [];
      for (const tag of labels) {
        const [x, y] = project(tag.at);
        pen.font = '600 14px "Microsoft YaHei UI", sans-serif';
        const textWidth = pen.measureText(tag.text).width + 8;
        let box;
        for (const [dx, dy] of [[tag.dx, tag.dy], [8, 20], [-textWidth - 7, 10], [7, -23], [-textWidth - 7, -20]]) {
          const left = Math.max(4, Math.min(width - textWidth - 4, x + dx));
          const top = Math.max(4, Math.min(height - 25, y + dy - 11));
          box = {left, top, right:left + textWidth, bottom:top + 22};
          if (!occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) break;
        }
        occupied.push(box);
        label(tag.text, [box.left + 4, box.top + 11], colors[tag.color]);
      }
      return;
    }

    const center = [width / 2, height / 2];
    const radius = Math.min(width, height) * .30;
    const topView = vector => [center[0] + vector[0] * radius, center[1] - vector[2] * radius];
    const incoming = topView(data.viewDir);
    const outgoing = topView(data.reflected);
    const mapped = topView(data.ws);
    arrow(incoming, center, ink);
    arrow(center, outgoing, amber);
    arrow(center, mapped, pink);
    dotAt(center, 5, ink, '#132025');
    label('入射', [incoming[0], incoming[1] - 16], ink, 'center');
    label('reflDir', [outgoing[0], outgoing[1] + 17], amber, 'center');
    label('bump', [mapped[0], mapped[1] - 16], pink, 'center');
    label('P', [center[0] + 9, center[1] - 11]);
    label(`reflDir → ${data.face} ${faces[data.face].name}`, [width / 2, height - 18], muted, 'center');
  }

  return { size, pixel, originUV, bumpUV, seam, brick, blue, faces, pivot, verticesOS,
    coordinateSteps, coordinateSketch, measure, normalLegs, diagram, number, tuple, cssColor };
})();
