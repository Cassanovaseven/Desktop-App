import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CardNode as CardNodeType } from '../mapping'
import { CardBody } from './CardBody'

// Handle dari reactflow.dev/learn/customization/custom-nodes: titik sambung untuk panah antar kartu.
export const CardNode = memo(function CardNode({ data }: NodeProps<CardNodeType>): React.JSX.Element {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <CardBody card={data.card} />
      <Handle type="source" position={Position.Right} />
    </>
  )
})

export const nodeTypes = {
  catatan: CardNode, file: CardNode, gambar: CardNode, tautan: CardNode, kode: CardNode, grup: CardNode
}
